-- ---------------------------------------------------------------------------
-- Phase 25 — deadlines: editing, your own names, "the date's wrong", moderation
-- ---------------------------------------------------------------------------
--
-- RUN ORDER: phase18_reports_and_hiding.sql → phase20_view_security.sql → THIS FILE.
-- It replaces two of phase 20's functions with wider ones, so re-running phase 20 after
-- this fails on them; run this file again instead.
--
-- Five changes, each closing a gap in what a deadline could do:
--
--   1. A deadline could never change. The poster now edits their own (title, type, due), and
--      an admin can edit any. Moving the date or changing the type clears the confirmations,
--      because people vouched for the old one. A poster's edit to a verified deadline sends it
--      back to pending, or a verification could be spent on a title written afterwards.
--
--   2. Any student gives any deadline a name only they see ("Rename for me"). It's a row
--      per person, read back through the view as `my_label`, never readable by anyone else.
--
--   3. "The date or details are wrong" was a report like "offensive", so it hid the row from
--      whoever said it and counted towards the three that hide it from everyone. A deadline
--      with the wrong date is still worth seeing, and is exactly the one a class needs the
--      warning on. It is now a dispute: counted next to the confirmations, visible to all,
--      and one person holds one side at a time — confirming withdraws your dispute and
--      disputing withdraws your confirmation. Only offensive/spam/other hide anything.
--
--   4. The insert policy checked who posted a row and nothing else, so a student could POST
--      `status: 'verified'` and skip review. A trigger now resets every column a student
--      doesn't own. The same trigger enforces the title limit and puts a deadline that
--      repeats a blocked one (same module, same title, same day) straight into blocked —
--      which is why phase 2 kept rejected rows instead of deleting them.
--
--   5. The console's actions on one deadline — confirm, block, unblock, remove — each change
--      the status and close the open reports in one audited transaction.
--
-- 'rejected' is still the stored status; the console calls it blocked.
--
-- Safe to re-run. Run it in the Supabase SQL editor.

do $$ begin
  if to_regprocedure('private_views.module_deadlines_public()') is null then
    raise exception 'Run phase20_view_security.sql first — this file replaces its deadline functions.';
  end if;
end $$;

alter table module_deadlines add column if not exists edited_at timestamptz;

-- ---------------------------------------------------------------------------
-- 1. What a student may write
-- ---------------------------------------------------------------------------

-- The same day in Dublin, not in UTC: an 00:30 deadline is the day the class sees it on.
create or replace function public.deadline_repeats_blocked(p_id uuid, p_module text, p_title text, p_due timestamptz)
  returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.module_deadlines d
     where d.status = 'rejected'
       and d.id <> p_id
       and d.module_key = p_module
       and lower(btrim(d.title)) = lower(btrim(p_title))
       and (d.due_at at time zone 'Europe/Dublin')::date = (p_due at time zone 'Europe/Dublin')::date);
$$;

create or replace function public.screen_new_deadline()
  returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.title := btrim(new.title);
  if char_length(new.title) = 0 or char_length(new.title) > 120 then
    raise exception 'a deadline needs a title of 1 to 120 characters';
  end if;

  if not public.is_trusted() then
    new.status := 'pending';
    new.verified_by := null;
    new.verified_at := null;
    new.source := 'student';
    new.edited_at := null;
    new.submitted_at := now();
  end if;

  if public.deadline_repeats_blocked(new.id, new.module_key, new.title, new.due_at) then
    new.status := 'rejected';
  end if;
  return new;
end $$;

drop trigger if exists screen_new_deadline on module_deadlines;
create trigger screen_new_deadline before insert on module_deadlines
  for each row execute function public.screen_new_deadline();

-- ---------------------------------------------------------------------------
-- 2. Editing
-- ---------------------------------------------------------------------------

create or replace function public.edit_deadline(p_deadline uuid, p_title text, p_kind text, p_due timestamptz)
  returns void language plpgsql security definer set search_path = '' as $$
declare
  d          public.module_deadlines;
  by_admin   boolean := public.is_admin();
  new_title  text := btrim(coalesce(p_title, ''));
  new_status text;
begin
  if auth.uid() is null or public.is_banned() then raise exception 'not allowed'; end if;

  select * into d from public.module_deadlines where id = p_deadline for update;
  if not found then raise exception 'no such deadline'; end if;
  if d.submitter_id <> auth.uid()::text and not by_admin then raise exception 'not allowed'; end if;
  if not by_admin and d.status = 'rejected' then raise exception 'this deadline was blocked'; end if;

  if char_length(new_title) = 0 or char_length(new_title) > 120 then
    raise exception 'a deadline needs a title of 1 to 120 characters';
  end if;
  if p_kind not in ('assignment', 'labReport', 'quiz', 'exam', 'presentation', 'other') then
    raise exception 'unknown kind %', p_kind;
  end if;
  -- A student can't move one into the past; an admin tidying an old row can.
  if not by_admin and p_due <= now() then raise exception 'the due date has passed'; end if;

  new_status := d.status;
  if not by_admin and d.status = 'verified' then new_status := 'pending'; end if;
  if not by_admin and public.deadline_repeats_blocked(d.id, d.module_key, new_title, p_due) then
    new_status := 'rejected';
  end if;

  if p_due <> d.due_at or p_kind <> d.kind then
    -- The poster still stands behind their own date, so their vouch survives their edit.
    delete from public.deadline_confirmations
     where deadline_id = d.id
       and (by_admin or confirmer_id <> auth.uid()::text);
    -- Disputes of the old date are answered by the new one. Only an admin resolves by name.
    update public.deadline_reports
       set resolved_at = now(), resolved_by = case when by_admin then auth.uid() end
     where deadline_id = d.id and reason = 'wrong' and resolved_at is null;
  end if;

  update public.module_deadlines
     set title = new_title, kind = p_kind, due_at = p_due, edited_at = now(),
         status = new_status,
         verified_by = case when new_status = 'pending' then null else verified_by end,
         verified_at = case when new_status = 'pending' then null else verified_at end
   where id = d.id;

  if by_admin then
    insert into public.admin_actions (actor_id, action, target, before, after)
    values (auth.uid(), 'deadline.edit', d.id::text,
            jsonb_build_object('title', d.title, 'kind', d.kind, 'due_at', d.due_at),
            jsonb_build_object('title', new_title, 'kind', p_kind, 'due_at', p_due));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Your own name for a deadline
-- ---------------------------------------------------------------------------
--
-- No policy on the table, as with hidden_authors: it's written and read only through the
-- function and the view below, each of which names the caller.

create table if not exists deadline_labels (
  user_id     uuid not null references auth.users (id) on delete cascade,
  deadline_id uuid not null references module_deadlines (id) on delete cascade,
  label       text not null check (char_length(label) between 1 and 80),
  updated_at  timestamptz not null default now(),
  primary key (user_id, deadline_id)
);

alter table deadline_labels enable row level security;
revoke all on table deadline_labels from public, anon, authenticated;

-- An empty or null label goes back to the shared title.
create or replace function public.set_deadline_label(p_deadline uuid, p_label text)
  returns void language plpgsql security definer set search_path = '' as $$
declare
  new_label text := btrim(coalesce(p_label, ''));
begin
  if auth.uid() is null then raise exception 'not allowed'; end if;
  if char_length(new_label) > 80 then raise exception 'a name can be at most 80 characters'; end if;

  if char_length(new_label) = 0 then
    delete from public.deadline_labels where user_id = auth.uid() and deadline_id = p_deadline;
    return;
  end if;

  if not exists (select 1 from public.module_deadlines where id = p_deadline) then
    raise exception 'no such deadline';
  end if;
  insert into public.deadline_labels (user_id, deadline_id, label)
  values (auth.uid(), p_deadline, new_label)
  on conflict (user_id, deadline_id) do update set label = excluded.label, updated_at = now();
end $$;

-- ---------------------------------------------------------------------------
-- 4. Confirming and disputing: one side each
-- ---------------------------------------------------------------------------

-- Phase 18's function, plus: any report takes back your confirmation.
create or replace function public.report_deadline(p_deadline uuid, p_reason text)
  returns void language plpgsql security definer set search_path = '' as $$
declare
  author text;
begin
  if auth.uid() is null or public.is_banned() then raise exception 'not allowed'; end if;
  if p_reason not in ('offensive', 'spam', 'wrong', 'other') then
    raise exception 'unknown reason %', p_reason;
  end if;

  select submitter_id into author from public.module_deadlines where id = p_deadline;
  if not found then raise exception 'no such deadline'; end if;
  if author = auth.uid()::text then raise exception 'that is your own deadline'; end if;

  delete from public.deadline_confirmations
   where deadline_id = p_deadline and confirmer_id = auth.uid()::text;

  insert into public.deadline_reports (deadline_id, reporter_id, reason)
  values (p_deadline, auth.uid(), p_reason)
  on conflict (deadline_id, reporter_id) do update
    set reason = excluded.reason, created_at = now(), resolved_at = null, resolved_by = null;
end $$;

-- Taking back your dispute (or any open report). A resolved one is the admin's record and stays.
create or replace function public.withdraw_deadline_report(p_deadline uuid)
  returns void language sql security definer set search_path = '' as $$
  delete from public.deadline_reports
   where deadline_id = p_deadline and reporter_id = auth.uid() and resolved_at is null;
$$;

-- Confirmations are written straight to the table by the app, so the other half of "one
-- side each" is a trigger.
create or replace function public.confirmation_withdraws_dispute()
  returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.deadline_reports
   where deadline_id = new.deadline_id and reporter_id::text = new.confirmer_id
     and reason = 'wrong' and resolved_at is null;
  return new;
end $$;

drop trigger if exists confirmation_withdraws_dispute on deadline_confirmations;
create trigger confirmation_withdraws_dispute after insert on deadline_confirmations
  for each row execute function public.confirmation_withdraws_dispute();

-- ---------------------------------------------------------------------------
-- 5. The console
-- ---------------------------------------------------------------------------

create or replace function public.moderate_deadline(p_deadline uuid, p_action text)
  returns void language plpgsql security definer set search_path = '' as $$
declare
  d            public.module_deadlines;
  open_reports int := 0;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_action not in ('confirm', 'block', 'unblock', 'remove') then
    raise exception 'unknown action %', p_action;
  end if;

  select * into d from public.module_deadlines where id = p_deadline for update;
  if not found then raise exception 'no such deadline'; end if;

  if p_action = 'remove' then
    -- Confirmations, reports and labels cascade. The audit row keeps what was there.
    delete from public.module_deadlines where id = d.id;
    insert into public.admin_actions (actor_id, action, target, before, after)
    values (auth.uid(), 'deadline.remove', d.id::text,
            jsonb_build_object('module_key', d.module_key, 'title', d.title, 'kind', d.kind,
                               'due_at', d.due_at, 'status', d.status, 'submitter_id', d.submitter_id),
            null);
    return;
  end if;

  -- Confirming or blocking is the decision every open report was waiting on.
  if p_action in ('confirm', 'block') then
    update public.deadline_reports
       set resolved_at = now(), resolved_by = auth.uid()
     where deadline_id = d.id and resolved_at is null;
    get diagnostics open_reports = row_count;
  end if;

  update public.module_deadlines
     set status = case p_action when 'confirm' then 'verified' when 'block' then 'rejected' else 'pending' end,
         verified_by = case when p_action = 'unblock' then null else auth.uid() end,
         verified_at = case when p_action = 'unblock' then null else now() end
   where id = d.id;

  insert into public.admin_actions (actor_id, action, target, before, after)
  values (auth.uid(), 'deadline.' || p_action, d.id::text,
          jsonb_build_object('status', d.status, 'open_reports', open_reports),
          jsonb_build_object('status', case p_action when 'confirm' then 'verified'
                                                     when 'block' then 'rejected' else 'pending' end));
end $$;

-- ---------------------------------------------------------------------------
-- 6. The two views students read, rebuilt with the new columns
-- ---------------------------------------------------------------------------
--
-- Phase 20's pattern: owner-rights function in private_views, caller-rights view over it.
-- Their columns grow, which `create or replace` can't do to a function, so both are dropped
-- and rebuilt. Existing columns keep their names and order, so builds that select them by
-- name read them as before.

drop view if exists public.deadline_confirmation_tallies;
drop view if exists public.module_deadlines_public;
drop function if exists private_views.deadline_confirmation_tallies();
drop function if exists private_views.module_deadlines_public();

create function private_views.deadline_confirmation_tallies()
  returns table (deadline_id uuid, confirm_count bigint, mine boolean,
                 dispute_count bigint, disputed_by_me boolean)
  language sql stable security definer set search_path = '' as $$
  with confirmed as (
    select c.deadline_id, count(distinct c.confirmer_id) as n,
           bool_or(c.confirmer_id = auth.uid()::text) as me
      from public.deadline_confirmations c
      left join public.profiles p on p.id::text = c.confirmer_id
     where not coalesce(p.banned_until > now(), false)
     group by c.deadline_id
  ), disputed as (
    select r.deadline_id, count(*) as n, bool_or(r.reporter_id = auth.uid()) as me
      from public.deadline_reports r
      left join public.profiles p on p.id = r.reporter_id
     where r.reason = 'wrong' and r.resolved_at is null
       and not coalesce(p.banned_until > now(), false)
     group by r.deadline_id
  )
  select deadline_id, coalesce(confirmed.n, 0), coalesce(confirmed.me, false),
         coalesce(disputed.n, 0), coalesce(disputed.me, false)
    from confirmed full join disputed using (deadline_id);
$$;

create function private_views.module_deadlines_public()
  returns table (id uuid, module_key text, at_group_key text, title text, due_at timestamptz,
                 kind text, submitted_at timestamptz, status text, verified_by uuid, is_mine boolean,
                 edited_at timestamptz, my_label text)
  language sql stable security definer set search_path = '' as $$
  select d.id, d.module_key, d.at_group_key, d.title, d.due_at, d.kind, d.submitted_at,
         d.status, d.verified_by,
         (d.submitter_id = auth.uid()::text),
         d.edited_at,
         (select l.label from public.deadline_labels l
           where l.user_id = auth.uid() and l.deadline_id = d.id)
    from public.module_deadlines d
   where d.status <> 'rejected'
     and not exists (select 1 from public.hidden_authors h
                      where h.user_id = auth.uid() and h.hidden_id = d.submitter_id)
     -- Your own report hides it from you — unless it's a dispute, which is about the date,
     -- not the post.
     and not exists (select 1 from public.deadline_reports r
                      where r.deadline_id = d.id and r.reporter_id = auth.uid()
                        and r.resolved_at is null and r.reason <> 'wrong')
     and (d.status = 'verified'
          or (select count(*) from public.deadline_reports r
               where r.deadline_id = d.id and r.resolved_at is null and r.reason <> 'wrong') < 3);
$$;

revoke all on function private_views.deadline_confirmation_tallies() from public, anon;
revoke all on function private_views.module_deadlines_public()       from public, anon;
grant execute on function private_views.deadline_confirmation_tallies() to authenticated, service_role;
grant execute on function private_views.module_deadlines_public()       to authenticated, service_role;

create view public.deadline_confirmation_tallies with (security_invoker = on) as
  select * from private_views.deadline_confirmation_tallies();
create view public.module_deadlines_public with (security_invoker = on) as
  select * from private_views.module_deadlines_public();

revoke all on public.deadline_confirmation_tallies, public.module_deadlines_public
  from public, anon, authenticated;
grant select on public.deadline_confirmation_tallies, public.module_deadlines_public
  to authenticated;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.deadline_repeats_blocked(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.screen_new_deadline()                                  from public, anon, authenticated;
revoke all on function public.confirmation_withdraws_dispute()                       from public, anon, authenticated;
revoke all on function public.edit_deadline(uuid, text, text, timestamptz)           from public, anon;
revoke all on function public.set_deadline_label(uuid, text)                         from public, anon;
revoke all on function public.report_deadline(uuid, text)                            from public, anon;
revoke all on function public.withdraw_deadline_report(uuid)                         from public, anon;
revoke all on function public.moderate_deadline(uuid, text)                          from public, anon;
grant execute on function public.edit_deadline(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.set_deadline_label(uuid, text)               to authenticated;
grant execute on function public.report_deadline(uuid, text)                  to authenticated;
grant execute on function public.withdraw_deadline_report(uuid)               to authenticated;
grant execute on function public.moderate_deadline(uuid, text)                to authenticated;

-- ---------------------------------------------------------------------------
-- Check it
-- ---------------------------------------------------------------------------
--
-- As a student (in a rolled-back transaction):
--
--   insert into module_deadlines (id, module_key, title, due_at, submitter_id, status)
--   values (gen_random_uuid(), 'CA106', 'x', now() + interval '1 day', auth.uid()::text, 'verified')
--   returning status;                                  -- pending
--
--   select * from deadline_labels;                     -- permission denied
--   select my_label, edited_at from module_deadlines_public limit 1;
--   select dispute_count, disputed_by_me from deadline_confirmation_tallies limit 1;
