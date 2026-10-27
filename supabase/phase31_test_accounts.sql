-- ---------------------------------------------------------------------------
-- Phase 31 — test accounts, listed with their passwords on the console
-- ---------------------------------------------------------------------------
--
-- A handful of accounts for trying the app as a student on each course. The console's
-- Test accounts page lists them with their passwords so an admin can sign in as one
-- without asking.
--
-- The passwords are not in this file, and must never be in any committed one: the repo is
-- public. They go in local-data/test_accounts.sql, which git ignores, and are run from
-- there in the SQL editor. The accounts themselves are made in the dashboard
-- (Authentication → Users → Add user, Auto Confirm), with the same passwords.
--
-- What's stored here is a note for admins, not what signs anyone in: Supabase keeps only
-- its own hash. Change a password in the dashboard and change it here too, or the page
-- shows a stale one.
--
-- Safe to re-run.

-- The test addresses aren't DCU ones, so the sign-up hook (phase 0) has to let them in.
insert into auth_domain_exceptions (email, note) values
  ('ce1@example.ie',   'Test account — CE1'),
  ('bmed1@example.ie', 'Test account — BMED1'),
  ('ece1@example.ie',  'Test account — ECE1'),
  ('mmac1@example.ie', 'Test account — MMAC1'),
  ('sse1@example.ie',  'Test account — SSE1')
on conflict (email) do nothing;

create table if not exists test_accounts (
  email    text primary key,
  password text not null,
  added_at timestamptz not null default now()
);

-- No policies: no client reads the table directly. Admins read it through the function.
alter table test_accounts enable row level security;
revoke all on table test_accounts from public, anon, authenticated;

create or replace function public.list_test_accounts()
  returns table (email text, password text)
  language sql security definer set search_path = '' stable as $$
  select t.email, t.password from public.test_accounts t
   where public.is_admin()
   order by t.email;
$$;

revoke all    on function public.list_test_accounts() from public, anon;
grant execute on function public.list_test_accounts() to authenticated;
