-- ---------------------------------------------------------------------------
-- Phase 22 — the console remembers a browser; the four-digit code unlocks it
-- ---------------------------------------------------------------------------
--
-- Replaces phase 15's way in. There, the console's server held the admin account's
-- password in its environment and signed in as it for anyone who typed the code. That
-- stopped working the moment the account was recreated with a new password, and it made
-- four digits the only thing between the internet and the console.
--
-- Now:
--
--   * A browser signs in once with an admin account's email and password. Supabase's own
--     session — a refresh token in a cookie — is what remembers it, for 30 days.
--   * After that, each visit asks only for the four-digit code. A right code opens the
--     console in that browser for 12 hours, or until Lock.
--   * Five wrong codes end that browser's session; it signs in with email again.
--   * The email sign-in opens the console by itself. It is the real credential, and the
--     way back in when the code is forgotten.
--
-- What the code is, and isn't. It can only be tried from a browser already holding an
-- admin's session, so nobody without the password gets a single guess. It locks the
-- console's pages on a remembered browser. It is not a second password for the database:
-- the session cookie alone reaches the API, which is why five wrong codes end the session
-- rather than merely refusing the sixth.
--
-- The unlock belongs to the Supabase session (the `session_id` in every access token), not
-- to a cookie of its own — signing out ends it, and there is no second token to steal.
--
-- Also retires what the old ways in left behind: phase 15's per-network attempt log and
-- its lock-for-everyone, and phase 11's per-admin PIN, unused since phase 15.
--
-- Needs phase 15 (the code itself). Safe to re-run. Run it in the Supabase SQL editor
-- BEFORE deploying the console that uses it.

do $$
begin
  if to_regclass('public.console_code') is null then
    raise exception 'Run phase15_console_code.sql first: this keeps its code and replaces its sign-in.';
  end if;
end $$;

-- One row per browser that has opened the console. No foreign key to auth.sessions: a
-- session that has ended keeps its row for a week, so the Security page can still count
-- the wrong codes that ended it.
create table if not exists console_sessions (
  session_id     uuid primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  unlocked_until timestamptz,
  wrong_codes    int not null default 0,
  updated_at     timestamptz not null default now()
);

create index if not exists console_sessions_user on console_sessions (user_id);

alter table console_sessions enable row level security;
revoke all on table console_sessions from public, anon, authenticated;

-- ---------------------------------------------------------------------------

-- The session this request was made with — in effect, the browser. Nulls when the token
-- names none, or its session has been ended. Reached only through the functions below.
create or replace function private.console_session(out session_id uuid, out signed_in_at timestamptz)
  language sql stable set search_path = '' as $$
  select s.id, s.created_at
    from auth.sessions s
   where s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid
     and s.user_id = auth.uid();
$$;

revoke all on function private.console_session() from public, anon, authenticated;

-- Called straight after an email-and-password sign-in, which opens the console without
-- the code. Only a session begun in the last five minutes may: one restored from a
-- remembered cookie calling this would make the code pointless.
create or replace function public.open_console_session() returns boolean
  language plpgsql security definer set search_path = '' as $$
declare
  s record;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  select * into s from private.console_session();
  if s.session_id is null or s.signed_in_at < now() - interval '5 minutes' then return false; end if;

  insert into public.console_sessions (session_id, user_id, unlocked_until, wrong_codes, updated_at)
  values (s.session_id, auth.uid(), now() + interval '12 hours', 0, now())
  on conflict (session_id) do update
    set unlocked_until = excluded.unlocked_until, wrong_codes = 0, updated_at = now();

  delete from public.console_sessions c
   where c.updated_at < now() - interval '7 days'
     and not exists (select 1 from auth.sessions x where x.id = c.session_id);
  return true;
end $$;

-- The code, from a remembered browser.
--
--   ok          right; open for 12 hours
--   wrong       not; attempts_left before this browser is signed out
--   signed_out  that was the fifth wrong code, and the session has been ended
--   expired     signed in more than 30 days ago; the session has been ended
--   no_code     no code has been set — sign in with email and set one
create or replace function public.enter_console_code(p_code text)
  returns table (status text, attempts_left int)
  language plpgsql security definer set search_path = '' as $$
declare
  s record;
  code text;
  wrong int;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  select * into s from private.console_session();
  if s.session_id is null then return query select 'signed_out'::text, 0; return; end if;

  if s.signed_in_at < now() - interval '30 days' then
    delete from auth.sessions where id = s.session_id;
    return query select 'expired'::text, 0;
    return;
  end if;

  select c.code_hash into code from public.console_code c where c.id;
  if code is null then return query select 'no_code'::text, 0; return; end if;

  insert into public.console_sessions (session_id, user_id) values (s.session_id, auth.uid())
  on conflict on constraint console_sessions_pkey do nothing;
  -- Locked, so two guesses sent at once cannot both be the fifth.
  select c.wrong_codes into wrong from public.console_sessions c
   where c.session_id = s.session_id for update;

  if wrong < 5 and code = extensions.crypt(coalesce(p_code, ''), code) then
    update public.console_sessions c
       set unlocked_until = now() + interval '12 hours', wrong_codes = 0, updated_at = now()
     where c.session_id = s.session_id;
    return query select 'ok'::text, 5;
    return;
  end if;

  update public.console_sessions c
     set wrong_codes = wrong + 1, updated_at = now()
   where c.session_id = s.session_id;

  if wrong + 1 >= 5 then
    delete from auth.sessions where id = s.session_id;
    return query select 'signed_out'::text, 0;
    return;
  end if;
  return query select 'wrong'::text, 5 - (wrong + 1);
end $$;

-- What the gate and the lock screen need. No row for a non-admin or an ended session.
create or replace function public.console_session_status()
  returns table (unlocked boolean, remembered boolean, has_code boolean, attempts_left int)
  language sql stable security definer set search_path = '' as $$
  select coalesce(c.unlocked_until > now(), false),
         s.signed_in_at >= now() - interval '30 days',
         exists (select 1 from public.console_code),
         greatest(0, 5 - coalesce(c.wrong_codes, 0))
    from private.console_session() s
    left join public.console_sessions c on c.session_id = s.session_id
   where s.session_id is not null
     and public.is_admin();
$$;

-- Lock: this browser stays remembered and asks for the code again.
create or replace function public.lock_console_session() returns void
  language sql security definer set search_path = '' as $$
  update public.console_sessions
     set unlocked_until = null, updated_at = now()
   where session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
     and user_id = auth.uid();
$$;

-- Ends every browser that has opened the console, this one included. Only those: an admin
-- is usually a student too, and this leaves their app signed in.
create or replace function public.end_console_sessions() returns int
  language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  delete from auth.sessions s using public.console_sessions c where s.id = c.session_id;
  get diagnostics n = row_count;
  update public.console_sessions set unlocked_until = null, updated_at = now();
  insert into public.admin_actions (actor_id, action, target, before, after)
  values (auth.uid(), 'console.sign_out_all', 'console', null, jsonb_build_object('sessions', n));
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Phase 15's code, without its lock-for-everyone
-- ---------------------------------------------------------------------------

create or replace function private.set_console_code(p_code text) returns void
  language plpgsql security definer set search_path = '' as $$
begin
  if p_code !~ '^[0-9]{4}$' then raise exception 'the code is exactly four digits'; end if;
  insert into public.console_code (id, code_hash, updated_at)
  values (true, extensions.crypt(p_code, extensions.gen_salt('bf', 10)), now())
  on conflict (id) do update set code_hash = excluded.code_hash, updated_at = now();
end $$;

revoke all on function private.set_console_code(text) from public, anon, authenticated;

drop function if exists public.console_code_status();
create function public.console_code_status()
  returns table (has_code boolean, wrong_today int)
  language sql security definer set search_path = '' stable as $$
  select exists (select 1 from public.console_code),
         (select coalesce(sum(wrong_codes), 0)::int from public.console_sessions
           where updated_at > now() - interval '24 hours')
   where public.is_admin();
$$;

drop function if exists public.check_console_code(text, text);
drop function if exists private.unlock_console();
drop table if exists public.console_code_attempts;
alter table public.console_code drop column if exists locked_at;

-- Phase 11: a PIN per admin with its own unlock cookie. Unused since phase 15, and empty.
drop function if exists public.set_admin_pin(text);
drop function if exists public.unlock_with_pin(text, text);
drop function if exists public.is_unlocked(text);
drop function if exists public.clear_unlock(text);
drop function if exists public.admin_pin_status();
drop table if exists public.admin_unlocks;
drop table if exists public.admin_pins;

-- ---------------------------------------------------------------------------

revoke all on function public.open_console_session()      from public, anon;
revoke all on function public.enter_console_code(text)    from public, anon;
revoke all on function public.console_session_status()    from public, anon;
revoke all on function public.lock_console_session()      from public, anon;
revoke all on function public.end_console_sessions()      from public, anon;
revoke all on function public.console_code_status()       from public, anon;
grant execute on function public.open_console_session()   to authenticated;
grant execute on function public.enter_console_code(text) to authenticated;
grant execute on function public.console_session_status() to authenticated;
grant execute on function public.lock_console_session()   to authenticated;
grant execute on function public.end_console_sessions()   to authenticated;
grant execute on function public.console_code_status()    to authenticated;
