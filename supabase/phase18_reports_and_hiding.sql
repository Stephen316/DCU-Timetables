-- ---------------------------------------------------------------------------
-- Phase 18 — reporting a deadline, and hiding the person who posted it
-- ---------------------------------------------------------------------------
--
-- App Review guideline 1.2: an app where people post content others see needs, inside the
-- app, a way to report what is objectionable and a way to block whoever posted it. A
-- deadline's title is free text that every classmate reads, so it qualifies. Cancellation
-- reports don't: they reach anyone only as an anonymous count, with nothing typed.
--
-- Both have to keep phase 3's promise that a deadline is anonymous to students. So neither
-- ever hands a student an id:
--
--   * Reporting names the deadline, not the person.
--   * Hiding names a deadline too, and the server looks up who posted it. The list of
--     people you've hidden is not readable, only countable — a readable list would be a
--     list of which accounts wrote which deadlines. The one way back is "show everyone
--     again", all at once.
--
-- A deadline three people have reported drops out of everyone's view until an admin looks
-- at it, unless a trusted student has already verified it. Your own report hides it from
-- you straight away.
--
-- Safe to re-run. Run it in the Supabase SQL editor.

create table if not exists deadline_reports (
  id          bigint generated always as identity primary key,
  deadline_id uuid not null references module_deadlines (id) on delete cascade,
  reporter_id uuid not null references auth.users (id) on delete cascade,
  reason      text not null check (reason in ('offensive', 'spam', 'wrong', 'other')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  unique (deadline_id, reporter_id)
);

create index if not exists deadline_reports_open on deadline_reports (deadline_id) where resolved_at is null;

-- hidden_id is text because module_deadlines.submitter_id is.
create table if not exists hidden_authors (
  user_id    uuid not null references auth.users (id) on delete cascade,
  hidden_id  text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, hidden_id)
);

alter table deadline_reports enable row level security;
alter table hidden_authors   enable row level security;

drop policy if exists "admin read" on deadline_reports;
create policy "admin read" on deadline_reports for select to authenticated
  using ((select public.is_admin()));

-- No policy on hidden_authors at all: not even its owner may read it (see above).
revoke all on table deadline_reports, hidden_authors from public, anon, authenticated;
grant select on table deadline_reports to authenticated;

-- ---------------------------------------------------------------------------
-- Students
-- ---------------------------------------------------------------------------

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

  -- Reporting again changes the reason and reopens it, rather than failing.
  insert into public.deadline_reports (deadline_id, reporter_id, reason)
  values (p_deadline, auth.uid(), p_reason)
  on conflict (deadline_id, reporter_id) do update
    set reason = excluded.reason, created_at = now(), resolved_at = null, resolved_by = null;
end $$;

create or replace function public.hide_author_of(p_deadline uuid)
  returns void language plpgsql security definer set search_path = '' as $$
declare
  author text;
begin
  if auth.uid() is null then raise exception 'not allowed'; end if;

  select submitter_id into author from public.module_deadlines where id = p_deadline;
  if not found then raise exception 'no such deadline'; end if;
  if author = auth.uid()::text then raise exception 'that is your own deadline'; end if;

  insert into public.hidden_authors (user_id, hidden_id)
  values (auth.uid(), author)
  on conflict do nothing;
end $$;

create or replace function public.hidden_author_count()
  returns int language sql security definer set search_path = '' stable as $$
  select count(*)::int from public.hidden_authors where user_id = auth.uid();
$$;

create or replace function public.unhide_all_authors()
  returns void language sql security definer set search_path = '' as $$
  delete from public.hidden_authors where user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- The view students read
-- ---------------------------------------------------------------------------
--
-- Same columns as phase 3, so `create or replace` keeps its grants; three more reasons a
-- row is left out.

create or replace view module_deadlines_public
  with (security_invoker = off) as
  select d.id, d.module_key, d.at_group_key, d.title, d.due_at, d.kind, d.submitted_at,
         d.status, d.verified_by,
         (d.submitter_id = auth.uid()::text) as is_mine
    from module_deadlines d
   where d.status <> 'rejected'
     -- From someone you've hidden.
     and not exists (select 1 from hidden_authors h
                      where h.user_id = auth.uid() and h.hidden_id = d.submitter_id)
     -- Reported by you and not yet looked at.
     and not exists (select 1 from deadline_reports r
                      where r.deadline_id = d.id and r.reporter_id = auth.uid()
                        and r.resolved_at is null)
     -- Reported by three people, and not already verified by a trusted student.
     and (d.status = 'verified'
          or (select count(*) from deadline_reports r
               where r.deadline_id = d.id and r.resolved_at is null) < 3);

-- ---------------------------------------------------------------------------
-- Admins
-- ---------------------------------------------------------------------------
--
-- 'dismiss' closes the reports and leaves the deadline up; 'remove' rejects the deadline
-- (phase 2's status, so a repeat of it is still recognised) and closes them.

create or replace function public.resolve_deadline_reports(p_deadline uuid, p_action text)
  returns void language plpgsql security definer set search_path = '' as $$
declare
  open_reports int;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_action not in ('dismiss', 'remove') then raise exception 'unknown action %', p_action; end if;

  update public.deadline_reports
     set resolved_at = now(), resolved_by = auth.uid()
   where deadline_id = p_deadline and resolved_at is null;
  get diagnostics open_reports = row_count;

  if p_action = 'remove' then
    update public.module_deadlines
       set status = 'rejected', verified_by = auth.uid(), verified_at = now()
     where id = p_deadline;
  end if;

  insert into public.admin_actions (actor_id, action, target, before, after)
  values (auth.uid(), 'report.' || p_action, p_deadline::text,
          jsonb_build_object('open_reports', open_reports), null);
end $$;

revoke all    on function public.report_deadline(uuid, text)          from public, anon;
revoke all    on function public.hide_author_of(uuid)                 from public, anon;
revoke all    on function public.hidden_author_count()                from public, anon;
revoke all    on function public.unhide_all_authors()                 from public, anon;
revoke all    on function public.resolve_deadline_reports(uuid, text) from public, anon;
grant execute on function public.report_deadline(uuid, text)          to authenticated;
grant execute on function public.hide_author_of(uuid)                 to authenticated;
grant execute on function public.hidden_author_count()                to authenticated;
grant execute on function public.unhide_all_authors()                 to authenticated;
grant execute on function public.resolve_deadline_reports(uuid, text) to authenticated;
