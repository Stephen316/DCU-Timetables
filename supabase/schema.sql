-- DCU Timetable — Supabase schema.
--
-- Paste the whole file into the SQL Editor and press Run. It is safe to run more than
-- once: every statement either creates something missing or replaces it in place.
--
-- Two things are shared between students, and nothing else ever leaves the device:
--   cancellation_reports  — "this class isn't on"
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

alter table cancellation_reports enable row level security;

-- Readable by anyone signed in; writable only as yourself.
drop policy if exists "read"       on cancellation_reports;
drop policy if exists "insert"     on cancellation_reports;
drop policy if exists "delete"     on cancellation_reports;
drop policy if exists "insert own" on cancellation_reports;
drop policy if exists "delete own" on cancellation_reports;

create policy "read" on cancellation_reports
  for select using (true);
create policy "insert own" on cancellation_reports
  for insert with check (auth.uid()::text = reporter_id);
create policy "delete own" on cancellation_reports
  for delete using (auth.uid()::text = reporter_id);

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
drop policy if exists "update own" on module_deadlines;
drop policy if exists "delete own" on module_deadlines;

create policy "read" on module_deadlines
  for select using (true);
create policy "insert own" on module_deadlines
  for insert with check (auth.uid()::text = submitter_id);
create policy "update own" on module_deadlines
  for update using (auth.uid()::text = submitter_id);
create policy "delete own" on module_deadlines
  for delete using (auth.uid()::text = submitter_id);

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
drop policy if exists "insert own" on deadline_confirmations;
drop policy if exists "delete own" on deadline_confirmations;

create policy "read" on deadline_confirmations
  for select using (true);
create policy "insert own" on deadline_confirmations
  for insert with check (auth.uid()::text = confirmer_id);
create policy "delete own" on deadline_confirmations
  for delete using (auth.uid()::text = confirmer_id);
