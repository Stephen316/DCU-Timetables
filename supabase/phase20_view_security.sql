-- ---------------------------------------------------------------------------
-- Phase 20 — the four owner-rights views, rebuilt so they can only be read
-- ---------------------------------------------------------------------------
--
-- RUN ORDER: phase18_reports_and_hiding.sql, then THIS FILE. Run this again if phase 18 is
-- ever re-run: its `create or replace view` puts the old kind of view back.
--
-- Phase 3 made these views run with their owner's rights (`security_invoker = off`), on
-- purpose: a student may see how many people reported a class but not who, and RLS can't
-- hide a column. That design stands. What was wrong, found 24 Sep 2026:
--
--   * Supabase's default privileges had given `anon` — anyone holding the public key the
--     app ships with, signed in or not — every privilege on three of them, and
--     `authenticated` the same. Phase 3 only ever meant `select` for signed-in users.
--   * `module_deadlines_public` is a plain view over one table, so Postgres let it be
--     written through, with the owner's rights, past RLS. Tested in a rolled-back
--     transaction as `anon`: an update and a delete of someone else's deadline both
--     succeeded.
--   * Supabase's linter flags every owner-rights view (0010_security_definer_view) as an
--     error, and it is right to: a view that bypasses RLS looks like any other view.
--
-- The rebuild keeps each view's name and columns, so the app and the console read them
-- exactly as before. The owner-rights part moves into a function in `private_views`, a
-- schema the API doesn't serve, and each view becomes an ordinary caller-rights view over
-- its function:
--
--   * The linter is satisfied: no view runs with its owner's rights.
--   * Nothing can be written through: a view over a function isn't updatable.
--   * The counting still sees every row: the function runs as its owner. And `auth.uid()`
--     is still whoever asked, so `mine` and `is_mine` still work — it reads the request's
--     JWT, which the function owner doesn't change.
--   * Only signed-in users can read, via `select` on the view and `execute` on the
--     function. `anon` has neither.
--
-- The cost: a filter the app sends (`event_key=in.(…)`) is applied after the function has
-- counted everything, not pushed into the count. At a year group's volume that is nothing.
--
-- Safe to re-run. Run it in the Supabase SQL editor.

do $$ begin
  if to_regclass('public.hidden_authors') is null or to_regclass('public.deadline_reports') is null then
    raise exception 'Run phase18_reports_and_hiding.sql first — the deadlines view filters on its tables.';
  end if;
end $$;

create schema if not exists private_views;
revoke all on schema private_views from public, anon;
grant usage on schema private_views to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The functions: each view's query as it stood, run as the owner
-- ---------------------------------------------------------------------------

-- Phase 4's shape: both sides counted, and your own stance.
create or replace function private_views.cancellation_tallies()
  returns table (event_key text, report_count bigint, on_count bigint, my_stance text)
  language sql stable security definer set search_path = '' as $$
  select r.event_key,
         count(distinct r.reporter_id) filter (where r.stance = 'cancelled'),
         count(distinct r.reporter_id) filter (where r.stance = 'on'),
         max(r.stance) filter (where r.reporter_id = auth.uid()::text)
    from public.cancellation_reports r
    left join public.profiles p on p.id::text = r.reporter_id
   where not coalesce(p.banned_until > now(), false)
   group by r.event_key;
$$;

create or replace function private_views.deadline_confirmation_tallies()
  returns table (deadline_id uuid, confirm_count bigint, mine boolean)
  language sql stable security definer set search_path = '' as $$
  select c.deadline_id,
         count(distinct c.confirmer_id),
         bool_or(c.confirmer_id = auth.uid()::text)
    from public.deadline_confirmations c
    left join public.profiles p on p.id::text = c.confirmer_id
   where not coalesce(p.banned_until > now(), false)
   group by c.deadline_id;
$$;

-- Phase 18's shape: rejected, hidden-author and reported deadlines left out.
create or replace function private_views.module_deadlines_public()
  returns table (id uuid, module_key text, at_group_key text, title text, due_at timestamptz,
                 kind text, submitted_at timestamptz, status text, verified_by uuid, is_mine boolean)
  language sql stable security definer set search_path = '' as $$
  select d.id, d.module_key, d.at_group_key, d.title, d.due_at, d.kind, d.submitted_at,
         d.status, d.verified_by,
         (d.submitter_id = auth.uid()::text)
    from public.module_deadlines d
   where d.status <> 'rejected'
     and not exists (select 1 from public.hidden_authors h
                      where h.user_id = auth.uid() and h.hidden_id = d.submitter_id)
     and not exists (select 1 from public.deadline_reports r
                      where r.deadline_id = d.id and r.reporter_id = auth.uid()
                        and r.resolved_at is null)
     and (d.status = 'verified'
          or (select count(*) from public.deadline_reports r
               where r.deadline_id = d.id and r.resolved_at is null) < 3);
$$;

-- Phase 5's shape: every profile for an admin, nothing for anyone else.
create or replace function private_views.contributor_stats()
  returns table (id uuid, pi text, role public.app_role, programme text, created_at timestamptz,
                 banned_until timestamptz, ban_reason text,
                 reports bigint, deadlines bigint, confirmations bigint, rejected bigint)
  language sql stable security definer set search_path = '' as $$
  select p.id, p.pi, p.role, p.programme, p.created_at, p.banned_until, p.ban_reason,
         (select count(*) from public.cancellation_reports r where r.reporter_id = p.id::text),
         (select count(*) from public.module_deadlines d where d.submitter_id = p.id::text),
         (select count(*) from public.deadline_confirmations c where c.confirmer_id = p.id::text),
         (select count(*) from public.module_deadlines d
           where d.submitter_id = p.id::text and d.status = 'rejected')
    from public.profiles p
   where public.is_admin();
$$;

revoke all on function private_views.cancellation_tallies()          from public, anon;
revoke all on function private_views.deadline_confirmation_tallies() from public, anon;
revoke all on function private_views.module_deadlines_public()       from public, anon;
revoke all on function private_views.contributor_stats()             from public, anon;
grant execute on function private_views.cancellation_tallies()          to authenticated, service_role;
grant execute on function private_views.deadline_confirmation_tallies() to authenticated, service_role;
grant execute on function private_views.module_deadlines_public()       to authenticated, service_role;
grant execute on function private_views.contributor_stats()             to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The views: same names and columns, caller's rights, read-only
-- ---------------------------------------------------------------------------

create or replace view public.cancellation_tallies with (security_invoker = on) as
  select * from private_views.cancellation_tallies();
create or replace view public.deadline_confirmation_tallies with (security_invoker = on) as
  select * from private_views.deadline_confirmation_tallies();
create or replace view public.module_deadlines_public with (security_invoker = on) as
  select * from private_views.module_deadlines_public();
create or replace view public.contributor_stats with (security_invoker = on) as
  select * from private_views.contributor_stats();

revoke all on public.cancellation_tallies, public.deadline_confirmation_tallies,
              public.module_deadlines_public, public.contributor_stats
  from public, anon, authenticated;
grant select on public.cancellation_tallies, public.deadline_confirmation_tallies,
                public.module_deadlines_public, public.contributor_stats
  to authenticated;

-- ---------------------------------------------------------------------------
-- Check it
-- ---------------------------------------------------------------------------
--
-- Advisors → Security: the four security_definer_view errors are gone.
--
--   select relname, reloptions from pg_class
--    where relname in ('cancellation_tallies', 'deadline_confirmation_tallies',
--                      'module_deadlines_public', 'contributor_stats');
--   -- every row: {security_invoker=on}
