-- DCU Timetable — phase 3: reports are anonymous to students, visible to admins.
--
-- RUN ORDER: schema.sql → phase0 → phase1 → phase2 → THIS FILE.
--
-- ⚠️  THIS IS A COORDINATED RELEASE. It stops older app builds reading report rows, and
--     those builds count reports client-side — so they will show every class as having
--     zero reports until they are updated. Ship the matching app build at the same time.
--
-- Until now `cancellation_reports` was readable by anyone signed in, and the app pulled
-- raw rows to tally them on the device. That meant any student could dump the table over
-- plain HTTP and see which account reported which class. The ids are not names, so this
-- was pseudonymous rather than identifying — but the app's own wording says "anonymous",
-- and that should be true rather than nearly true.
--
-- The shape throughout: RLS cannot restrict columns, so wherever some callers may see an
-- aggregate but not the rows behind it, the boundary is a VIEW, not a policy. Each view
-- below runs with its owner's rights (`security_invoker = off`) and deliberately exposes
-- counts only.
--
-- Two properties hold at once inside these views, and the design leans on both:
--   * `security_invoker = off` means the view reads every row, whatever RLS says, so it
--     can count.
--   * `auth.uid()` still resolves to whoever made the request — it comes from the JWT
--     claim on the connection, which view ownership does not touch.
-- So one query can count everybody AND say whether you are among them, without ever
-- returning anyone's id. That is why each view carries a `mine` column rather than the
-- app making a second request for its own rows.

-- ---------------------------------------------------------------------------
-- 1. Cancellation reports
-- ---------------------------------------------------------------------------

drop policy if exists "read" on cancellation_reports;
drop policy if exists "read own or admin" on cancellation_reports;

-- Your own rows, so the app can still show "you reported this". Everyone else's are
-- invisible unless you are an admin — which is what makes the console able to moderate.
create policy "read own or admin" on cancellation_reports
  for select using (reporter_id = auth.uid()::text or public.is_admin());

drop view if exists cancellation_tallies;
create view cancellation_tallies
  with (security_invoker = off) as
  select r.event_key,
         count(distinct r.reporter_id) as report_count,
         bool_or(r.reporter_id = auth.uid()::text) as mine
    from cancellation_reports r
    -- Joined on text, never `reporter_id::uuid`: a single row whose id is not a valid
    -- uuid would make the whole view raise instead of returning a count.
    left join profiles p on p.id::text = r.reporter_id
   where not coalesce(p.banned_until > now(), false)
   group by r.event_key;

grant select on cancellation_tallies to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Deadline confirmations
-- ---------------------------------------------------------------------------

drop policy if exists "read" on deadline_confirmations;
drop policy if exists "read own or admin" on deadline_confirmations;

create policy "read own or admin" on deadline_confirmations
  for select using (confirmer_id = auth.uid()::text or public.is_admin());

drop view if exists deadline_confirmation_tallies;
create view deadline_confirmation_tallies
  with (security_invoker = off) as
  select c.deadline_id,
         count(distinct c.confirmer_id) as confirm_count,
         bool_or(c.confirmer_id = auth.uid()::text) as mine
    from deadline_confirmations c
    left join profiles p on p.id::text = c.confirmer_id
   where not coalesce(p.banned_until > now(), false)
   group by c.deadline_id;

grant select on deadline_confirmation_tallies to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Deadlines
-- ---------------------------------------------------------------------------
--
-- Different shape from the two above: every student must read *all* the rows (that is the
-- feature) but none of the submitter ids. That is column-level, so the base table becomes
-- admin-only and students read a view that swaps `submitter_id` for a boolean.

drop policy if exists "read" on module_deadlines;
drop policy if exists "read admin" on module_deadlines;

create policy "read admin" on module_deadlines
  for select using (public.is_admin());

drop view if exists module_deadlines_public;
create view module_deadlines_public
  with (security_invoker = off) as
  select d.id, d.module_key, d.at_group_key, d.title, d.due_at, d.kind, d.submitted_at,
         d.status, d.verified_by,
         -- All the app ever needed the id for: it drives "you can delete this".
         (d.submitter_id = auth.uid()::text) as is_mine
    from module_deadlines d
   where d.status <> 'rejected';

grant select on module_deadlines_public to authenticated;

-- A rejected deadline stays in the table — so a repeat submission of the same wrong date
-- can be recognised — but drops out of the view, so students stop seeing it.

-- ---------------------------------------------------------------------------
-- 4. Check it
-- ---------------------------------------------------------------------------
--
-- As an ordinary student, all three of these should come back empty, and the tallies
-- should still have numbers in them:
--
--   select * from cancellation_reports;      -- only your own rows
--   select * from deadline_confirmations;    -- only your own rows
--   select * from module_deadlines;          -- empty
--   select * from cancellation_tallies;      -- counts and `mine`, no ids
--   select * from module_deadlines_public;   -- every deadline, is_mine instead of an id
