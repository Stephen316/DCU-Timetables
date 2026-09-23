-- ---------------------------------------------------------------------------
-- Phase 11 — a 4-digit PIN that unlocks an already-authenticated session
-- ---------------------------------------------------------------------------
--
-- READ THIS BEFORE CHANGING IT. The PIN is not a credential. It cannot sign anyone in,
-- and nothing here is reachable without a valid Supabase session: every function is
-- granted to `authenticated` only, and every one of them reads auth.uid().
--
-- That is the entire security argument. A 4-digit PIN is 10 000 possibilities, which is
-- minutes of guessing against a public endpoint — so it is never exposed as one. To reach
-- these functions at all you must already hold a session cookie that was issued by a full
-- email-and-password sign-in. The PIN is the second factor on a device that already passed
-- the first, in the way a banking app holds a strong token in the keychain and asks four
-- digits to release it.
--
-- Consequences worth stating plainly:
--   * Losing the PIN costs nothing. Sign in with the password again and set a new one.
--   * Stealing the PIN costs nothing without the device's session cookie.
--   * Stealing the device's session cookie is already game over, PIN or no PIN. The PIN
--     narrows the window where an unlocked, unattended browser is enough.
--
-- Safe to re-run. Run it in the Supabase SQL editor.

-- pgcrypto lives in `extensions` on Supabase, and every function below sets an empty
-- search_path, so each call has to be schema-qualified.
create extension if not exists pgcrypto with schema extensions;

create table if not exists admin_pins (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  -- bcrypt, cost 10. Roughly 100ms to verify, which is irrelevant to you once a day and
  -- ruinous to anyone trying all 10 000 — but the grant is what actually stops them.
  pin_hash        text not null,
  failed_attempts int not null default 0,
  locked_until    timestamptz,
  updated_at      timestamptz not null default now()
);

-- One row per unlocked browser. The cookie holds the raw token; only its hash is stored,
-- so a database leak does not hand anyone a working unlock.
create table if not exists admin_unlocks (
  token_hash text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists admin_unlocks_user on admin_unlocks (user_id);

-- RLS on, and deliberately no policies at all. Nothing reads these tables directly; the
-- security-definer functions below are the only way in, and they bypass RLS. A policy here
-- would be a second, weaker door into a table holding unlock tokens.
alter table admin_pins    enable row level security;
alter table admin_unlocks enable row level security;

-- ---------------------------------------------------------------------------

create or replace function public.set_admin_pin(p_pin text)
  returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_pin !~ '^[0-9]{4}$' then raise exception 'a PIN is exactly four digits'; end if;

  insert into public.admin_pins (user_id, pin_hash, failed_attempts, locked_until, updated_at)
  values (auth.uid(), extensions.crypt(p_pin, extensions.gen_salt('bf', 10)), 0, null, now())
  on conflict (user_id) do update
    set pin_hash        = excluded.pin_hash,
        failed_attempts = 0,
        locked_until    = null,
        updated_at      = now();

  -- Changing the PIN drops every existing unlock. If you are changing it because you think
  -- someone saw it, leaving other browsers unlocked would defeat the point.
  delete from public.admin_unlocks where user_id = auth.uid();
end $$;

-- Returns true and records the unlock, or false. Never says which of "wrong PIN" and
-- "no PIN set" it was — that distinction is only useful to someone guessing.
create or replace function public.unlock_with_pin(p_pin text, p_token text)
  returns boolean language plpgsql security definer set search_path = '' as $$
declare
  row public.admin_pins%rowtype;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_token is null or length(p_token) < 32 then raise exception 'bad unlock token'; end if;

  select * into row from public.admin_pins where user_id = auth.uid();
  if not found then return false; end if;
  if row.locked_until is not null and row.locked_until > now() then return false; end if;

  if row.pin_hash = extensions.crypt(p_pin, row.pin_hash) then
    update public.admin_pins
       set failed_attempts = 0, locked_until = null
     where user_id = auth.uid();

    delete from public.admin_unlocks where expires_at < now();
    insert into public.admin_unlocks (token_hash, user_id, expires_at)
    values (encode(extensions.digest(p_token, 'sha256'), 'hex'), auth.uid(), now() + interval '12 hours')
    on conflict (token_hash) do nothing;
    return true;
  end if;

  -- Five wrong tries, then fifteen minutes. Someone with your unlocked laptop gets a
  -- handful of guesses at 10 000, not all of them.
  update public.admin_pins
     set failed_attempts = row.failed_attempts + 1,
         locked_until    = case when row.failed_attempts + 1 >= 5
                                then now() + interval '15 minutes' else null end
   where user_id = auth.uid();
  return false;
end $$;

create or replace function public.is_unlocked(p_token text)
  returns boolean language sql security definer set search_path = '' stable as $$
  select exists (
    select 1 from public.admin_unlocks
     where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
       and user_id    = auth.uid()
       and expires_at > now()
  );
$$;

create or replace function public.clear_unlock(p_token text)
  returns void language sql security definer set search_path = '' as $$
  delete from public.admin_unlocks
   where user_id = auth.uid()
     and token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
$$;

-- What the lock screen needs to render itself, without leaking the hash.
create or replace function public.admin_pin_status()
  returns table (has_pin boolean, locked_until timestamptz, attempts_left int)
  language sql security definer set search_path = '' stable as $$
  select true,
         p.locked_until,
         greatest(0, 5 - p.failed_attempts)
    from public.admin_pins p
   where p.user_id = auth.uid()
  union all
  select false, null::timestamptz, 5
   where not exists (select 1 from public.admin_pins where user_id = auth.uid())
  limit 1;
$$;

-- `authenticated` only, everywhere. This is the grant that makes a 4-digit secret
-- defensible: anon cannot reach any of it.
revoke all on function public.set_admin_pin(text)          from public, anon;
revoke all on function public.unlock_with_pin(text, text)   from public, anon;
revoke all on function public.is_unlocked(text)             from public, anon;
revoke all on function public.clear_unlock(text)            from public, anon;
revoke all on function public.admin_pin_status()            from public, anon;

grant execute on function public.set_admin_pin(text)        to authenticated;
grant execute on function public.unlock_with_pin(text, text) to authenticated;
grant execute on function public.is_unlocked(text)          to authenticated;
grant execute on function public.clear_unlock(text)         to authenticated;
grant execute on function public.admin_pin_status()         to authenticated;

-- Nothing reads these tables directly — the definer functions above are the only door,
-- and they bypass RLS. Supabase grants SELECT on new public tables to anon and
-- authenticated by default; leaving that means the only thing between anon and a table of
-- unlock tokens is a policy list that happens to be empty, which is one careless
-- `create policy` away from not being empty.
revoke all on table public.admin_pins    from anon, authenticated, public;
revoke all on table public.admin_unlocks from anon, authenticated, public;
