-- DCU Timetable — phase 1: definitive verdicts on a class.
--
-- RUN ORDER:  schema.sql  →  phase0_identity.sql  →  THIS FILE.
-- Safe to run more than once.
--
-- Until now the only way a class could be flagged as off was three students voting for it.
-- This adds a second, higher authority: one trusted person saying so outright. The app
-- applies `verdict > crowd > nothing` (see CancellationRules), and shows the two
-- differently on purpose — a stated fact and a tally of guesses are not the same claim.

create table if not exists event_verdicts (
  -- EXACTLY CancellationRules.eventKey: "<activity.raw>|<ISO8601 start, UTC, Z>".
  -- A key that differs by so much as a "+00:00" lands on nothing, silently, forever.
  event_key       text primary key,
  state           text not null check (state in ('cancelled', 'running', 'moved')),
  note            text,
  -- For state = 'moved'. Null in every other case.
  room_override   text,
  start_override  timestamptz,
  -- Denormalised so the app can fetch a module's verdicts in one query instead of
  -- assembling a key list first.
  module_key      text,
  decided_by      uuid not null references profiles (id),
  -- What students are shown as the source: "the class rep", "Dr Ryan's email". NOT a name
  -- pulled from `profiles` — §4 keeps those admin-only, and a verdict is read by everyone.
  -- Null renders as "an organiser".
  decided_by_label text,
  decided_at      timestamptz not null default now(),
  source          text not null default 'admin'
     check (source in ('admin', 'lecturer', 'loop', 'student_reported'))
);

create index if not exists event_verdicts_module_key_idx on event_verdicts (module_key);

alter table event_verdicts enable row level security;

drop policy if exists "read"    on event_verdicts;
drop policy if exists "write"   on event_verdicts;
drop policy if exists "amend"   on event_verdicts;
drop policy if exists "retract" on event_verdicts;

create policy "read" on event_verdicts
  for select using (true);

-- `decided_by = auth.uid()` stops a trusted user filing a verdict under someone else's
-- name, which the audit log would then faithfully record as that person's doing.
create policy "write" on event_verdicts
  for insert with check (public.is_trusted() and not public.is_banned()
                         and decided_by = auth.uid());

-- Both halves matter. USING decides which rows may be changed; WITH CHECK decides what
-- they may be changed into — without it, an amendment could reassign the row's author.
create policy "amend" on event_verdicts
  for update using       (public.is_trusted() and not public.is_banned())
              with check (public.is_trusted() and not public.is_banned()
                          and decided_by = auth.uid());

-- Deleting a verdict erases the record that it ever existed, so it is the one action here
-- reserved to an admin. A mistaken verdict is corrected by posting 'running' over it,
-- which leaves the history intact.
create policy "retract" on event_verdicts
  for delete using (public.is_admin());

-- Housekeeping: a verdict on a class that has already happened is dead weight. Run
-- occasionally, or from a scheduled job:
--
--   delete from event_verdicts where decided_at < now() - interval '60 days';
