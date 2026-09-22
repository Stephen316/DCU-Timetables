-- DCU Timetable — Supabase schema.
--
-- Paste the whole file into the SQL Editor and press Run. It is safe to run more than
-- once, and safe to run AFTER the phase files — which is the part that matters, and the
-- part this file used to get wrong.
--
-- ⚠️  READ THIS BEFORE EDITING. Re-running an earlier version of this file silently undid
--     later migrations, because it recreated `read` policies that phase 3 had dropped and
--     left `insert own` without the ban check phase 0 added. Nothing errored; the database
--     just quietly went back to being readable by anyone holding the anon key.
--
--     So: every policy below must match the FINAL state after phase 8, not the state this
--     file originally shipped. If you tighten a policy in a phase file, mirror it here.
--     The duplication is deliberate — one file that is always safe to re-run beats two
--     files that are only safe in one order.
--
--     Read policies are owned by phase3_anonymity.sql and are deliberately NOT created
--     here. A fresh run of this file alone leaves the tables readable by nobody, which is
--     the right way to fail.
--
-- Two things are shared between students, and nothing else ever leaves the device:
--   cancellation_reports  — "this class was cancelled" (or "it went ahead")
--   module_deadlines      — assignments, quizzes and exams, with confirmations

-- ---------------------------------------------------------------------------
-- 1. Cancellation reports
-- ---------------------------------------------------------------------------

create table if not exists cancellation_reports (
  event_key   text not null,
  reporter_id text not null,
  reported_at timestamptz not null default now(),
  primary key (event_key, reporter_id)      -- one vote per person, enforced by the DB
);

-- Which way the vote went. Added in phase4_stances.sql, which also rebuilds
-- cancellation_tallies to count the two sides separately — run that file too.
alter table cancellation_reports
  add column if not exists stance text not null default 'cancelled';
alter table cancellation_reports
  drop constraint if exists cancellation_reports_stance_check;
alter table cancellation_reports
  add constraint cancellation_reports_stance_check
  check (stance in ('cancelled', 'on'));

alter table cancellation_reports enable row level security;

-- Writable only as yourself. Read is phase 3's to grant, not this file's.
drop policy if exists "read"       on cancellation_reports;
drop policy if exists "insert"     on cancellation_reports;
drop policy if exists "delete"     on cancellation_reports;
drop policy if exists "insert own" on cancellation_reports;
drop policy if exists "delete own" on cancellation_reports;

-- No update policy anywhere in this file, on purpose. The app only ever inserts and
-- deletes; its repeat-write path is `ON CONFLICT DO NOTHING`, which needs insert alone.
-- An update grant would let a row's owner column be rewritten and buy nothing.
create policy "insert own" on cancellation_reports
  for insert with check ((select auth.uid())::text = reporter_id
                         and not (select public.is_banned()));
create policy "delete own" on cancellation_reports
  for delete using ((select auth.uid())::text = reporter_id);

-- ---------------------------------------------------------------------------
-- 2. Deadlines
-- ---------------------------------------------------------------------------

create table if not exists module_deadlines (
  id           uuid primary key,
  module_key   text not null,
  title        text not null,
  due_at       timestamptz not null,
  kind         text not null default 'assignment',
  submitter_id text not null,
  submitted_at timestamptz not null default now()
);

-- The class a deadline is due at (a TimetableEvent.groupKey). Null = the whole module.
alter table module_deadlines add column if not exists at_group_key text;

create index if not exists module_deadlines_module_key_idx
  on module_deadlines (module_key);

alter table module_deadlines enable row level security;

drop policy if exists "read"       on module_deadlines;
drop policy if exists "insert own" on module_deadlines;
drop policy if exists "delete own" on module_deadlines;
-- Unqualified names from a version of this file that predates ownership checks. They were
-- never dropped, so they survived every re-run — `insert`/`delete using (true)` sitting
-- alongside the `own` policies, which permissive OR-ing turns into no check at all.
drop policy if exists "insert"     on module_deadlines;
drop policy if exists "delete"     on module_deadlines;
-- Granted by an earlier version of this file and never used by the app.
drop policy if exists "update own" on module_deadlines;

create policy "insert own" on module_deadlines
  for insert with check ((select auth.uid())::text = submitter_id
                         and not (select public.is_banned()));
create policy "delete own" on module_deadlines
  for delete using ((select auth.uid())::text = submitter_id);

-- ---------------------------------------------------------------------------
-- 3. Deadline confirmations — "this date is right"
-- ---------------------------------------------------------------------------

create table if not exists deadline_confirmations (
  deadline_id  uuid not null references module_deadlines (id) on delete cascade,
  confirmer_id text not null,
  confirmed_at timestamptz not null default now(),
  primary key (deadline_id, confirmer_id)   -- one vouch per person
);

alter table deadline_confirmations enable row level security;

drop policy if exists "read"       on deadline_confirmations;
drop policy if exists "insert"     on deadline_confirmations;
drop policy if exists "delete"     on deadline_confirmations;
drop policy if exists "insert own" on deadline_confirmations;
drop policy if exists "delete own" on deadline_confirmations;

create policy "insert own" on deadline_confirmations
  for insert with check ((select auth.uid())::text = confirmer_id
                         and not (select public.is_banned()));
create policy "delete own" on deadline_confirmations
  for delete using ((select auth.uid())::text = confirmer_id);

-- ---------------------------------------------------------------------------
-- 4. Housekeeping
-- ---------------------------------------------------------------------------
--
-- The app only ever asks for deadlines due today or later, so old rows are invisible
-- long before they are large. Run this occasionally (or from a scheduled job) to stop
-- the table growing for the life of each module:
--
--   delete from module_deadlines where due_at < now() - interval '60 days';
--
-- Confirmations cascade with the row they belong to.
