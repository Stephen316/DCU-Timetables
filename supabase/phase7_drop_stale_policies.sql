-- ---------------------------------------------------------------------------
-- Phase 7 — drop the permissive policies that earlier phases meant to remove
-- ---------------------------------------------------------------------------
--
-- Postgres ORs permissive policies for the same command. A leftover `using (true)`
-- alongside a narrow policy does not add an exception to it — it replaces it, because
-- `narrow OR true` is `true`.
--
-- Five such policies were live, all `to public`, which includes `anon` — and the anon key
-- ships inside every app install:
--
--   cancellation_reports   read    true   defeated "read own or admin"  (phase 3)
--   deadline_confirmations read    true   defeated "read own or admin"  (phase 3)
--   module_deadlines       read    true   defeated "read admin"         (phase 3)
--   module_deadlines       insert  true   defeated "insert own"         (phase 0)
--   module_deadlines       delete  true   defeated "delete own"         (schema)
--
-- Verified live before writing this: an unauthenticated request carrying only the anon key
-- returned a cancellation report including its `reporter_id`, which is the one field
-- phase 3 exists to hide. The `delete` policy was the worse of the two — any holder of
-- that key could delete any deadline.
--
-- HOW THIS HAPPENED, because it will happen again:
--
-- `schema.sql` creates `read` on all three tables. Phase 3 drops them. They were back, so
-- `schema.sql` has been re-run since phase 3 — re-running it resurrects exactly what the
-- later phases removed. The bare `insert` / `delete` on `module_deadlines` are older still:
-- `schema.sql` drops `insert own` / `delete own` but never the unqualified names, so they
-- survived every re-run since before ownership checks existed.
--
-- `schema.sql` needs the same drops added, or a note that it is not safe to re-run. Until
-- then, re-running it reopens all of this and this file has to be re-applied after.
--
-- Safe to re-run. Run it in the Supabase SQL editor.

begin;

drop policy if exists "read"   on cancellation_reports;
drop policy if exists "read"   on deadline_confirmations;
drop policy if exists "read"   on module_deadlines;
drop policy if exists "insert" on module_deadlines;
drop policy if exists "delete" on module_deadlines;

commit;

-- NOT dropped: `read` on `event_verdicts`. That one is `using (true)` on purpose — a
-- verdict is meant to be readable by everyone, and it carries `decided_by_label` rather
-- than a name precisely so it can be (phase 1).

-- ---------------------------------------------------------------------------
-- Check it
-- ---------------------------------------------------------------------------
--
-- Nothing below should return a row for a caller who is not the owner or an admin.
--
--   select tablename, policyname, cmd, roles
--     from pg_policies
--    where schemaname = 'public'
--      and policyname in ('read', 'insert', 'delete')
--    order by tablename;
--
-- Expected: one row only — event_verdicts / read.
--
-- Then, from a terminal, with the anon key and no login:
--
--   curl "$URL/rest/v1/cancellation_reports?select=reporter_id&limit=1" -H "apikey: $ANON"
--
-- Expected: []   (it returned a real reporter_id before this ran)
--
-- And as a signed-in student, not an admin:
--   select count(*) from cancellation_reports;   -- only your own rows
--   select count(*) from module_deadlines;       -- 0
