-- ---------------------------------------------------------------------------
-- Phase 5 — gate contributor_stats to admins
-- ---------------------------------------------------------------------------
--
-- `contributor_stats` is `security_invoker = off`, so it reads every `profiles` row
-- whatever RLS says. Phase 2 then granted select on it to `authenticated` — which handed
-- every signed-in student every other user's id, pi, role, programme, ban status and
-- ban_reason, undoing the profiles policy phase 3 depends on.
--
-- Omitting `display_name` was not enough. `pi` is the identifier a student shares with you
-- privately to be granted trust, and `ban_reason` is free text about a person.
--
-- The grant has to stay: the console authenticates as you, which is the `authenticated`
-- role, so revoking it would lock the console out along with everyone else. The gate goes
-- inside the view instead.
--
-- `auth.uid()` still resolves to the calling user inside a definer view — it reads a
-- request-local setting, not the current role — which is the same property
-- `cancellation_tallies` relies on for `my_stance`. So `is_admin()` evaluates for the
-- caller: every row for you, zero rows for anyone else. It is declared `stable` and takes
-- no arguments, so it is evaluated once per query, not once per row.
--
-- Safe to re-run. Run it in the Supabase SQL editor.

drop view if exists contributor_stats;
create view contributor_stats
  with (security_invoker = off) as
  select p.id, p.pi, p.role, p.programme, p.created_at, p.banned_until, p.ban_reason,
         (select count(*) from cancellation_reports   r where r.reporter_id  = p.id::text) as reports,
         (select count(*) from module_deadlines       d where d.submitter_id = p.id::text) as deadlines,
         (select count(*) from deadline_confirmations c where c.confirmer_id = p.id::text) as confirmations,
         -- The column that actually matters for moderation. Raw volume flags your most
         -- useful contributors just as loudly as your worst.
         (select count(*) from module_deadlines d
           where d.submitter_id = p.id::text and d.status = 'rejected')                    as rejected
    from profiles p
   where public.is_admin();

revoke all on contributor_stats from anon, authenticated;
grant select on contributor_stats to authenticated;

-- ---------------------------------------------------------------------------
-- Check it
-- ---------------------------------------------------------------------------
--
-- As you (admin):              select count(*) from contributor_stats;  -- every profile
-- As any other signed-in user: select count(*) from contributor_stats;  -- 0
--
-- The Supabase linter will still flag this view, and the three tally views, as
-- SECURITY DEFINER. That warning is expected and correct to ignore here: RLS cannot
-- restrict columns, so a definer view is the only way to serve a crowd count without
-- serving the crowd. The thing that makes it safe is what the view selects and who it
-- lets through — not the invoker setting.
