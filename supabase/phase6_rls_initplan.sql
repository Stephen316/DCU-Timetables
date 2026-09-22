-- ---------------------------------------------------------------------------
-- Phase 6 — evaluate auth.uid() once per query, not once per row
-- ---------------------------------------------------------------------------
--
-- Supabase's "Auth RLS Initialization Plan" lint. A policy that calls `auth.uid()`
-- directly has it re-evaluated for every row the query touches. Wrapping the call in a
-- scalar subquery — `(select auth.uid())` — lets the planner hoist it into an InitPlan and
-- run it once.
--
-- Same for `public.is_admin()`, `is_trusted()` and `is_banned()`, and more so: each one
-- reads `profiles`, so an unhoisted call is a table lookup per row rather than a GUC read
-- per row.
--
-- This is a performance fix, not a security one. Every policy below keeps exactly the
-- predicate it had; only the bracketing changes. Behaviour is identical.
--
-- The earlier phase files are left as they were run — they are the record of what was
-- applied and when. This file supersedes the policies it names.
--
-- `schema.sql` also creates some of these policies. It is deliberately not edited here:
-- it defines the same policy names, so this file wins by running later.
--
-- Safe to re-run. Run it in the Supabase SQL editor.

begin;

-- ---------------------------------------------------------------------------
-- profiles  (phase 0)
-- ---------------------------------------------------------------------------

drop policy if exists "read own"   on profiles;
create policy "read own" on profiles
  for select using (id = (select auth.uid()) or (select public.is_admin()));

-- WITH CHECK is not optional: USING alone lets the row be rewritten to another owner.
drop policy if exists "update own" on profiles;
create policy "update own" on profiles
  for update
  using      (id = (select auth.uid()) or (select public.is_admin()))
  with check (id = (select auth.uid()) or (select public.is_admin()));

-- ---------------------------------------------------------------------------
-- cancellation_reports  (schema.sql + phase 0 + phase 3)
-- ---------------------------------------------------------------------------

drop policy if exists "read own or admin" on cancellation_reports;
create policy "read own or admin" on cancellation_reports
  for select using (reporter_id = (select auth.uid())::text
                    or (select public.is_admin()));

drop policy if exists "insert own" on cancellation_reports;
create policy "insert own" on cancellation_reports
  for insert with check ((select auth.uid())::text = reporter_id
                         and not (select public.is_banned()));

drop policy if exists "delete own" on cancellation_reports;
create policy "delete own" on cancellation_reports
  for delete using ((select auth.uid())::text = reporter_id);

-- ---------------------------------------------------------------------------
-- module_deadlines  (schema.sql + phase 0 + phase 3)
-- ---------------------------------------------------------------------------
--
-- "read admin" is untouched: it is `public.is_admin()` alone, rewritten below only so the
-- function call is hoisted too.

drop policy if exists "read admin" on module_deadlines;
create policy "read admin" on module_deadlines
  for select using ((select public.is_admin()));

drop policy if exists "insert own" on module_deadlines;
create policy "insert own" on module_deadlines
  for insert with check ((select auth.uid())::text = submitter_id
                         and not (select public.is_banned()));

drop policy if exists "delete own" on module_deadlines;
create policy "delete own" on module_deadlines
  for delete using ((select auth.uid())::text = submitter_id);

-- ---------------------------------------------------------------------------
-- deadline_confirmations  (schema.sql + phase 0 + phase 3)
-- ---------------------------------------------------------------------------

drop policy if exists "read own or admin" on deadline_confirmations;
create policy "read own or admin" on deadline_confirmations
  for select using (confirmer_id = (select auth.uid())::text
                    or (select public.is_admin()));

drop policy if exists "insert own" on deadline_confirmations;
create policy "insert own" on deadline_confirmations
  for insert with check ((select auth.uid())::text = confirmer_id
                         and not (select public.is_banned()));

drop policy if exists "delete own" on deadline_confirmations;
create policy "delete own" on deadline_confirmations
  for delete using ((select auth.uid())::text = confirmer_id);

-- ---------------------------------------------------------------------------
-- event_verdicts  (phase 1)
-- ---------------------------------------------------------------------------
--
-- "read" stays `using (true)` — nothing to hoist. "retract" is admin-only.

drop policy if exists "write" on event_verdicts;
create policy "write" on event_verdicts
  for insert with check ((select public.is_trusted())
                         and not (select public.is_banned())
                         and decided_by = (select auth.uid()));

drop policy if exists "amend" on event_verdicts;
create policy "amend" on event_verdicts
  for update
  using      ((select public.is_trusted()) and not (select public.is_banned()))
  with check ((select public.is_trusted()) and not (select public.is_banned())
              and decided_by = (select auth.uid()));

drop policy if exists "retract" on event_verdicts;
create policy "retract" on event_verdicts
  for delete using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- admin_actions  (phase 0)
-- ---------------------------------------------------------------------------

drop policy if exists "admin read" on admin_actions;
create policy "admin read" on admin_actions
  for select using ((select public.is_admin()));

commit;

-- ---------------------------------------------------------------------------
-- Check it
-- ---------------------------------------------------------------------------
--
-- The lint should clear for every table above. Behaviour must not change, so re-check the
-- things the policies actually protect:
--
--   As a signed-in student:
--     select * from cancellation_reports;   -- only your own rows
--     select * from module_deadlines;       -- empty (admin-only since phase 3)
--     select * from profiles;               -- only your own row
--     select count(*) from contributor_stats;  -- 0, once phase 5 has run
--
--   As you (admin):
--     select count(*) from profiles;        -- every row
--
-- The four "Security Definer View" warnings will remain, and should. RLS cannot restrict
-- columns, so a definer view is the only way to serve a crowd count without serving the
-- crowd — see the note at the end of phase 5.
