-- DCU Timetable — phase 45: DCU-only addresses, enforced on every path into auth.users.
--
-- RUN ORDER: phase0_identity.sql (defines the sign-up hook and auth_domain_exceptions) → THIS FILE.
-- Safe to run more than once.
--
-- Why: the Before User Created hook (phase 0 §11) only covers creation. The Auth API is public
-- HTTP, so from a command line someone can also:
--   PUT /auth/v1/user  {"email": "anyone@gmail.com"}   -- after signing in as a DCU student
-- and, once they click the confirmation link, the account carries a non-DCU address. The app
-- never changes email, so refusing every change to a non-DCU address costs nothing.
--
-- This trigger also backstops sign-up itself: if the dashboard hook is ever switched off or
-- replaced, an insert of a non-DCU address into auth.users still fails.
--
-- ⚠️  STILL A DASHBOARD STEP (cannot be done from SQL):
--     Authentication → Hooks → "Before User Created" → Postgres → public.hook_before_user_created → Enabled
--     Authentication → Sign In / Providers → "Allow anonymous sign-ins" → OFF
--     Authentication → Sign In / Providers → Phone → OFF (phone sign-ups carry no email)
--     Authentication → Providers → Email → "Confirm email" → ON (docs/SIGN_IN.md)
--     Verify with: curl -s -X POST "$SUPABASE_URL/auth/v1/signup" -H "apikey: $ANON_KEY" \
--       -H 'Content-Type: application/json' -d '{"email":"someone@example.com","password":"x12345678"}'
--     It must answer 403 "Sign up with your DCU address". (Use an address you control.)

create or replace function public.guard_auth_email() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  address text := lower(new.email);
  domain  text := (regexp_match(coalesce(address, ''), '^[^@]+@([^@]+)$'))[1];
begin
  -- Updates that leave the address alone (last_sign_in_at, password, tokens...) pass untouched,
  -- so existing non-DCU accounts (the console admin, App Review) keep working.
  if tg_op = 'UPDATE' and new.email is not distinct from old.email then
    return new;
  end if;

  -- Anonymous / phone-only rows have no email; the dashboard switches above close those.
  -- A null email is refused here too, so they cannot slip in as an unaddressed user.
  if address is null then
    raise exception 'an account needs a DCU email address' using errcode = '42501';
  end if;

  if domain in ('dcu.ie', 'mail.dcu.ie') then
    return new;
  end if;

  if exists (select 1 from public.auth_domain_exceptions where lower(email) = address) then
    return new;
  end if;

  raise exception 'Use your DCU address (@dcu.ie or @mail.dcu.ie).' using errcode = '42501';
end $$;

revoke all on function public.guard_auth_email() from public, anon, authenticated;

drop trigger if exists guard_auth_email on auth.users;
create trigger guard_auth_email
  before insert or update of email on auth.users
  for each row execute function public.guard_auth_email();

-- Check it worked (as postgres in the SQL editor; rolls back, so nothing is left behind):
--   begin;
--   update auth.users set email = 'x@gmail.com' where id = (select id from auth.users limit 1);
--   -- expect: ERROR  Use your DCU address (@dcu.ie or @mail.dcu.ie).
--   rollback;
