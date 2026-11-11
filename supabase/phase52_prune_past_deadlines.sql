-- DCU Timetable — phase 52: deadlines are deleted fourteen days after they fall due.
--
-- RUN ORDER: after phase 37 (pg_cron is enabled there). Safe to run more than once.
--
-- Why: nothing pruned module_deadlines, so the table grew for the life of every module. The
-- app shows a deadline in Pending until the end of its day, then for fourteen days under
-- Completed → Past (mobile/src/core/deadline.ts, PAST_DEADLINE_DAYS). After that nobody can
-- see it, so it goes.
--
-- Everything hanging off a deadline goes with it (ON DELETE CASCADE on each): confirmations,
-- reports, labels and the details history. A ticked-off id left in a student's own device
-- storage simply stops matching anything.

create or replace function public.prune_past_deadlines(keep interval default interval '14 days')
  returns integer
  language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  delete from public.module_deadlines where due_at < now() - keep;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.prune_past_deadlines(interval) from public, anon, authenticated;

-- Hourly is plenty: the app's own cut-off is a whole day, so a row lingering an hour past
-- fourteen days is never on anyone's screen. cron.schedule with an existing job name replaces it.
select cron.schedule('prune-past-deadlines', '17 * * * *', $$select public.prune_past_deadlines()$$);

-- Check (as postgres in the SQL editor):
--   select count(*) from public.module_deadlines where due_at < now() - interval '14 days';  -- due to go
--   select public.prune_past_deadlines();                                                     -- go now; returns the count
--   select jobname, schedule, active from cron.job where jobname = 'prune-past-deadlines';
