-- DCU Timetable — phase 50: no account exists until the DCU mailbox has been proved.
--
-- RUN ORDER: after phase 37 (pg_cron is enabled there) and phase 45. Safe to run more than once.
--
-- Why: Supabase's own sign-up writes the auth.users row (and the profile the sign-up trigger
-- makes) the moment the form is submitted, then waits for the confirmation click. An address
-- nobody proved they own is stored for as long as nobody cleans it up. This phase moves the
-- waiting out of auth.users:
--
--   1. The `signup` Edge Function checks the address and stores a *pending* row here — the
--      password encrypted, the link token only as a hash — and emails the link.
--   2. The link opens /verify.html, whose button POSTs the token back to the function.
--      (A button, because mail scanners GET every link in a message; a GET changes nothing.)
--   3. Only then does the function create the auth.users row, already confirmed.
--
-- Pending rows expire after an hour and are swept every ten minutes. Nothing here is readable
-- by a client: RLS is on with no policies, and the functions are for the service role only.
--
-- ⚠️  DASHBOARD STEPS (cannot be done from SQL) — see docs/SIGN_IN.md:
--     Authentication → Sign In / Providers → "Allow new users to sign up" → OFF
--       (closes POST /auth/v1/signup and magic-link/OTP account creation; the admin API the
--        function uses is unaffected). Without this the old route stays open and this phase
--        protects nothing.
--     Edge Functions → deploy `signup` with JWT verification OFF, and set its secrets.

create table if not exists public.pending_signups (
  email        text primary key,           -- lower-cased
  secret       text not null,              -- the password, AES-GCM encrypted by the function
  token_hash   text not null unique,       -- SHA-256 of the emailed token; the token is never stored
  created_at   timestamptz not null default now(),
  sent_at      timestamptz not null default now(),
  expires_at   timestamptz not null
);

alter table public.pending_signups enable row level security;
-- No policies, deliberately: only the service role (the function) can touch this table.
revoke all on public.pending_signups from anon, authenticated;

-- Does a (confirmed or not) account already use this address? The function asks, so it can
-- email "you already have an account" instead of a second sign-up link, without ever
-- telling the person at the keyboard which addresses are registered.
create or replace function public.auth_email_exists(address text) returns boolean
  language sql security definer set search_path = '' stable as $$
  select exists (select 1 from auth.users where lower(email) = lower(address));
$$;

revoke all on function public.auth_email_exists(text) from public, anon, authenticated;
grant execute on function public.auth_email_exists(text) to service_role;

-- Pending sign-ups past their hour.
create or replace function public.purge_expired_signups() returns integer
  language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  delete from public.pending_signups where expires_at < now();
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.purge_expired_signups() from public, anon, authenticated;

-- Accounts made before this phase, by the old route, that never confirmed. Once sign-up is
-- switched off in the dashboard none can appear, so this only clears what is already there.
create or replace function public.purge_unverified_users(grace interval default interval '1 day')
  returns integer
  language plpgsql security definer set search_path = '' as $$
declare
  u record;
  n integer := 0;
begin
  for u in
    select id from auth.users
     where email_confirmed_at is null
       and phone_confirmed_at is null
       and last_sign_in_at is null
       and created_at < now() - grace
  loop
    begin
      delete from auth.users where id = u.id;
      n := n + 1;
    exception when foreign_key_violation then
      null; -- referenced by authored data: leave it for a human to look at
    end;
  end loop;
  return n;
end $$;

revoke all on function public.purge_unverified_users(interval) from public, anon, authenticated;

-- cron.schedule with an existing job name replaces it, so re-running is harmless.
select cron.schedule('purge-pending-signups', '*/10 * * * *',
  $$select public.purge_expired_signups(); select public.purge_unverified_users()$$);

-- Check (as postgres in the SQL editor):
--   select email, expires_at from public.pending_signups;                 -- who is waiting
--   select id, email, created_at from auth.users where email_confirmed_at is null;  -- legacy rows
--   select public.purge_unverified_users();                               -- clear them now; returns the count
--   select jobname, schedule, active from cron.job where jobname = 'purge-pending-signups';
