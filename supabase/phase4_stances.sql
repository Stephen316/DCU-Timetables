-- ---------------------------------------------------------------------------
-- Phase 4 — a report has a side
-- ---------------------------------------------------------------------------
--
-- Until now a row in `cancellation_reports` could only mean "this class was cancelled",
-- and the only way to push back on three mistaken reports was a class rep posting a
-- verdict. A student who walked into a running lecture had nothing to say.
--
-- `stance` gives the row a side. The primary key is unchanged, so it stays one vote per
-- person per class — switching sides is a delete and a re-insert, which is all the app has
-- policies for and all it needs (see `CancellationStore.submit`).
--
-- Safe to re-run. Run it in the Supabase SQL editor.

alter table cancellation_reports
  add column if not exists stance text not null default 'cancelled';

-- Named explicitly so the re-run drops the same constraint it adds.
alter table cancellation_reports
  drop constraint if exists cancellation_reports_stance_check;
alter table cancellation_reports
  add constraint cancellation_reports_stance_check
  check (stance in ('cancelled', 'on'));

-- ---------------------------------------------------------------------------
-- The tally view
-- ---------------------------------------------------------------------------
--
-- Replaces the phase-3 view. Same contract — counts out, no reporter ids out — with the
-- cancellation count split from the contradiction count, and `mine` widened from a boolean
-- into the caller's own stance.
--
-- `security_invoker = off` for the same reason as before: RLS on the base table shows a
-- student only their own rows, so a view running as the caller would count exactly one
-- person every time. Running as the owner is what makes a crowd count possible without
-- handing out the crowd.

drop view if exists cancellation_tallies;
create view cancellation_tallies
  with (security_invoker = off) as
  select r.event_key,
         count(distinct r.reporter_id)
           filter (where r.stance = 'cancelled') as report_count,
         count(distinct r.reporter_id)
           filter (where r.stance = 'on')        as on_count,
         -- One row per (event_key, reporter_id) by primary key, so this max() is over at
         -- most one value: the caller's own stance, or null when they haven't voted.
         max(r.stance) filter (where r.reporter_id = auth.uid()::text) as my_stance
    from cancellation_reports r
    -- Joined on text, never `reporter_id::uuid`: a single row whose id is not a valid
    -- uuid would make the whole view raise instead of returning a count.
    left join profiles p on p.id::text = r.reporter_id
   where not coalesce(p.banned_until > now(), false)
   group by r.event_key;

grant select on cancellation_tallies to authenticated;

-- ---------------------------------------------------------------------------
-- Check it
-- ---------------------------------------------------------------------------
--
-- As a signed-in student:
--   select * from cancellation_tallies;   -- report_count, on_count, my_stance; no ids
--   select * from cancellation_reports;   -- still only your own rows
