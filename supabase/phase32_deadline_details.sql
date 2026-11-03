-- ---------------------------------------------------------------------------
-- Phase 32 — a Details box on every deadline, which anyone can edit
-- ---------------------------------------------------------------------------
--
-- RUN ORDER: phase25_deadlines.sql → phase26_grade_weight.sql → THIS FILE. It rebuilds the
-- view students read and replaces `report_deadline`, so re-running phase 25 or 26 afterwards
-- takes the details back out of the view; run this file again after either.
--
-- A deadline's title, type, date and weight are the poster's (phase 25). What to hand in,
-- where, the brief's quirks — that's knowledge the whole class has, so `details` is the one
-- part any signed-in student can change, on anyone's deadline. Nothing records who takes
-- which module, so "anyone on the module" is enforced the way posting is: any student who
-- isn't banned, on any deadline they can see.
--
-- An open box is easy to vandalise, so three things back it:
--
--   1. Every save keeps the version it replaced, with who wrote that one and when, in
--      `deadline_details_history`. Only an admin can read it. Students see only the text and
--      when it last changed — never who changed it, as with everything else on a deadline.
--   2. `details_edited_by` is the last editor's account id, for the console.
--   3. A new report reason, `details`. It flags the deadline for the console without hiding
--      it or counting towards the three reports that do: the date underneath is still right.
--      Anyone may raise it, the poster included, since it's usually someone else's words they
--      are reporting. It doesn't take back the reporter's confirmation either, for the same
--      reason.
--
-- Safe to re-run. Run it in the Supabase SQL editor.

do $$ begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'module_deadlines' and column_name = 'grade_weight') then
    raise exception 'Run phase26_grade_weight.sql first.';
  end if;
end $$;

-- Empty rather than null, so "no details" has one spelling. 2000 matches DETAILS_LIMIT in the app.
alter table module_deadlines add column if not exists details text not null default '';
alter table module_deadlines add column if not exists details_edited_at timestamptz;
alter table module_deadlines add column if not exists details_edited_by uuid references auth.users (id) on delete set null;
alter table module_deadlines drop constraint if exists module_deadlines_details_length;
alter table module_deadlines add constraint module_deadlines_details_length
  check (char_length(details) <= 2000);

-- ---------------------------------------------------------------------------
-- 1. The versions a save replaced
-- ---------------------------------------------------------------------------

create table if not exists deadline_details_history (
  id          bigint generated always as identity primary key,
  deadline_id uuid not null references module_deadlines (id) on delete cascade,
  -- The text as it was before this save, and who wrote that text, and when.
  details     text not null,
  written_by  uuid references auth.users (id) on delete set null,
  written_at  timestamptz,
  -- The save that replaced it.
  replaced_by uuid references auth.users (id) on delete set null,
  replaced_at timestamptz not null default now()
);

create index if not exists deadline_details_history_deadline
  on deadline_details_history (deadline_id, replaced_at desc);

alter table deadline_details_history enable row level security;

drop policy if exists "admin read" on deadline_details_history;
create policy "admin read" on deadline_details_history for select to authenticated
  using ((select public.is_admin()));

revoke all on table deadline_details_history from public, anon, authenticated;
grant select on table deadline_details_history to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Writing details: the only way a student changes someone else's deadline
-- ---------------------------------------------------------------------------
--
-- Students have no UPDATE on module_deadlines at all, so this function is the whole gate:
-- it touches `details` and the two columns that say who and when, and nothing else.

create or replace function public.set_deadline_details(p_deadline uuid, p_details text)
  returns void language plpgsql security definer set search_path = '' as $$
declare
  d           public.module_deadlines;
  by_admin    boolean := public.is_admin();
  new_details text := btrim(coalesce(p_details, ''));
begin
  if auth.uid() is null or public.is_banned() then raise exception 'not allowed'; end if;
  if char_length(new_details) > 2000 then raise exception 'details can be at most 2000 characters'; end if;

  select * into d from public.module_deadlines where id = p_deadline for update;
  if not found then raise exception 'no such deadline'; end if;
  if not by_admin and d.status = 'rejected' then raise exception 'this deadline was blocked'; end if;

  -- Saving what's already there is no edit, and leaves no history.
  if new_details = d.details then return; end if;

  insert into public.deadline_details_history (deadline_id, details, written_by, written_at, replaced_by)
  values (d.id, d.details, d.details_edited_by, d.details_edited_at, auth.uid());

  update public.module_deadlines
     set details = new_details, details_edited_at = now(), details_edited_by = auth.uid()
   where id = d.id;

  if by_admin then
    insert into public.admin_actions (actor_id, action, target, before, after)
    values (auth.uid(), 'deadline.details', d.id::text,
            jsonb_build_object('details', d.details), jsonb_build_object('details', new_details));
  end if;
end $$;

revoke all on function public.set_deadline_details(uuid, text) from public, anon;
grant execute on function public.set_deadline_details(uuid, text) to authenticated;

-- A student POSTing a new deadline with details is its first editor; the trigger says so,
-- rather than trusting whatever the request claimed. Kept apart from phase 25's screening
-- trigger so neither file has to restate the other.
create or replace function public.screen_new_deadline_details()
  returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.details := btrim(coalesce(new.details, ''));
  if new.details = '' then
    new.details_edited_at := null;
    new.details_edited_by := null;
  else
    new.details_edited_at := now();
    new.details_edited_by := auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists screen_new_deadline_details on module_deadlines;
create trigger screen_new_deadline_details before insert on module_deadlines
  for each row execute function public.screen_new_deadline_details();

-- ---------------------------------------------------------------------------
-- 3. Reporting the details
-- ---------------------------------------------------------------------------

alter table deadline_reports drop constraint if exists deadline_reports_reason_check;
alter table deadline_reports add constraint deadline_reports_reason_check
  check (reason in ('offensive', 'spam', 'wrong', 'other', 'details'));

-- Phase 25's function, plus `details`: open to the poster, and leaving confirmations alone.
create or replace function public.report_deadline(p_deadline uuid, p_reason text)
  returns void language plpgsql security definer set search_path = '' as $$
declare
  author text;
begin
  if auth.uid() is null or public.is_banned() then raise exception 'not allowed'; end if;
  if p_reason not in ('offensive', 'spam', 'wrong', 'other', 'details') then
    raise exception 'unknown reason %', p_reason;
  end if;

  select submitter_id into author from public.module_deadlines where id = p_deadline;
  if not found then raise exception 'no such deadline'; end if;
  if p_reason <> 'details' and author = auth.uid()::text then raise exception 'that is your own deadline'; end if;

  if p_reason <> 'details' then
    delete from public.deadline_confirmations
     where deadline_id = p_deadline and confirmer_id = auth.uid()::text;
  end if;

  insert into public.deadline_reports (deadline_id, reporter_id, reason)
  values (p_deadline, auth.uid(), p_reason)
  on conflict (deadline_id, reporter_id) do update
    set reason = excluded.reason, created_at = now(), resolved_at = null, resolved_by = null;
end $$;

revoke all on function public.report_deadline(uuid, text) from public, anon;
grant execute on function public.report_deadline(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The view students read, with the details
-- ---------------------------------------------------------------------------
--
-- Phase 26's view, two columns wider. A `details` report hides nothing, so it's left out
-- of both report checks alongside `wrong`. `details_edited_by` stays out: who wrote what is
-- the console's to know.

drop view if exists public.module_deadlines_public;
drop function if exists private_views.module_deadlines_public();

create function private_views.module_deadlines_public()
  returns table (id uuid, module_key text, at_group_key text, title text, due_at timestamptz,
                 kind text, submitted_at timestamptz, status text, verified_by uuid, is_mine boolean,
                 edited_at timestamptz, my_label text, grade_weight smallint,
                 details text, details_edited_at timestamptz)
  language sql stable security definer set search_path = '' as $$
  select d.id, d.module_key, d.at_group_key, d.title, d.due_at, d.kind, d.submitted_at,
         d.status, d.verified_by,
         (d.submitter_id = auth.uid()::text),
         d.edited_at,
         (select l.label from public.deadline_labels l
           where l.user_id = auth.uid() and l.deadline_id = d.id),
         d.grade_weight,
         d.details,
         d.details_edited_at
    from public.module_deadlines d
   where d.status <> 'rejected'
     and not exists (select 1 from public.hidden_authors h
                      where h.user_id = auth.uid() and h.hidden_id = d.submitter_id)
     and not exists (select 1 from public.deadline_reports r
                      where r.deadline_id = d.id and r.reporter_id = auth.uid()
                        and r.resolved_at is null and r.reason not in ('wrong', 'details'))
     and (d.status = 'verified'
          or (select count(*) from public.deadline_reports r
               where r.deadline_id = d.id and r.resolved_at is null
                 and r.reason not in ('wrong', 'details')) < 3);
$$;

revoke all on function private_views.module_deadlines_public() from public, anon;
grant execute on function private_views.module_deadlines_public() to authenticated, service_role;

create view public.module_deadlines_public with (security_invoker = on) as
  select * from private_views.module_deadlines_public();

revoke all on public.module_deadlines_public from public, anon, authenticated;
grant select on public.module_deadlines_public to authenticated;
