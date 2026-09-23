-- ---------------------------------------------------------------------------
-- Phase 15 — the console opens with a 4-digit code, and nothing else
-- ---------------------------------------------------------------------------
--
-- There is no sign-in page. The console's server holds the admin account's credentials in
-- its environment (CONSOLE_ADMIN_EMAIL / CONSOLE_ADMIN_PASSWORD) and signs in as that
-- account itself; the code decides whether it hands that session to the browser.
--
-- A 4-digit code is 10 000 possibilities on a public URL, so the whole defence is how many
-- guesses anyone gets:
--
--   * 3 wrong codes from one IP lock that IP for 24 hours. IPv6 counts per /64, since one
--     home connection holds billions of addresses.
--   * 10 wrong codes in 24 hours from all IPs together lock the console for everyone until
--     it is reset here. Per-IP limits alone are beaten by anyone with many addresses —
--     about 1 700 of them finds the code on average. This caps any attacker at 10 guesses
--     in 10 000.
--
-- The check runs only for the admin session the server has just opened, never for anon:
-- the anon key ships in every app install, and a check anon could call would let anyone
-- claim any IP they liked.
--
-- Set the code (and clear any lock) from the SQL editor:
--
--   select private.set_console_code('1234');
--   select private.unlock_console();          -- after the 10-in-24h lock
--
-- Safe to re-run. Run it in the Supabase SQL editor.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- One row, ever.
create table if not exists console_code (
  id         boolean primary key default true check (id),
  code_hash  text not null,
  locked_at  timestamptz,
  updated_at timestamptz not null default now()
);

-- One row per attempt. The IP is stored hashed, and rows older than a week are deleted
-- as attempts come in — they matter for a day, and an address is personal data.
create table if not exists console_code_attempts (
  id     bigint generated always as identity primary key,
  ip_key text not null,
  ok     boolean not null,
  at     timestamptz not null default now()
);

create index if not exists console_code_attempts_ip on console_code_attempts (ip_key, at);
create index if not exists console_code_attempts_at on console_code_attempts (at);

alter table console_code          enable row level security;
alter table console_code_attempts enable row level security;
revoke all on table console_code, console_code_attempts from public, anon, authenticated;

-- ---------------------------------------------------------------------------

create or replace function private.set_console_code(p_code text) returns void
  language plpgsql security definer set search_path = '' as $$
begin
  if p_code !~ '^[0-9]{4}$' then raise exception 'the code is exactly four digits'; end if;
  insert into public.console_code (id, code_hash, locked_at, updated_at)
  values (true, extensions.crypt(p_code, extensions.gen_salt('bf', 10)), null, now())
  on conflict (id) do update
    set code_hash = excluded.code_hash, locked_at = null, updated_at = now();
  delete from public.console_code_attempts;
end $$;

create or replace function private.unlock_console() returns void
  language sql security definer set search_path = '' as $$
  update public.console_code set locked_at = null;
  delete from public.console_code_attempts;
$$;

revoke all on function private.set_console_code(text) from public, anon, authenticated;
revoke all on function private.unlock_console()       from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The check
-- ---------------------------------------------------------------------------
--
--   ok         the code is right
--   wrong      it is not; attempts_left says how many this IP has
--   ip_locked  this IP has used its 3 in the last 24 hours
--   locked     the console is locked for everyone — reset in the SQL editor
--   no_code    no code has been set yet
--
-- A locked IP is refused before the code is compared, so a guess from it neither counts
-- nor reveals anything.

create or replace function public.check_console_code(p_code text, p_ip text)
  returns table (status text, attempts_left int)
  language plpgsql security definer set search_path = '' as $$
declare
  row public.console_code%rowtype;
  ip text := encode(extensions.digest(coalesce(p_ip, ''), 'sha256'), 'hex');
  ip_fails int;
  all_fails int;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;

  delete from public.console_code_attempts where at < now() - interval '7 days';

  select * into row from public.console_code where id;
  if not found then return query select 'no_code'::text, 0; return; end if;
  if row.locked_at is not null then return query select 'locked'::text, 0; return; end if;

  -- Wrong codes from this IP since its last right one, within the day.
  select count(*) into ip_fails
    from public.console_code_attempts a
   where a.ip_key = ip and not a.ok and a.at > now() - interval '24 hours'
     and a.at > coalesce((select max(b.at) from public.console_code_attempts b
                           where b.ip_key = ip and b.ok), '-infinity');
  if ip_fails >= 3 then return query select 'ip_locked'::text, 0; return; end if;

  if row.code_hash = extensions.crypt(coalesce(p_code, ''), row.code_hash) then
    insert into public.console_code_attempts (ip_key, ok) values (ip, true);
    return query select 'ok'::text, 3;
    return;
  end if;

  insert into public.console_code_attempts (ip_key, ok) values (ip, false);

  select count(*) into all_fails
    from public.console_code_attempts a
   where not a.ok and a.at > now() - interval '24 hours';
  if all_fails >= 10 then
    update public.console_code set locked_at = now() where id;
    return query select 'locked'::text, 0;
    return;
  end if;

  return query select 'wrong'::text, 3 - (ip_fails + 1);
end $$;

-- Changing the code from the console's Security page, once in.
create or replace function public.change_console_code(p_code text) returns void
  language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  perform private.set_console_code(p_code);
  insert into public.admin_actions (actor_id, action, target, before, after)
  values (auth.uid(), 'console.code', 'console', null, null);
end $$;

-- What the Security page shows. Counts only.
create or replace function public.console_code_status()
  returns table (has_code boolean, locked boolean, wrong_today int)
  language sql security definer set search_path = '' stable as $$
  select exists (select 1 from public.console_code),
         coalesce((select locked_at is not null from public.console_code where id), false),
         (select count(*)::int from public.console_code_attempts
           where not ok and at > now() - interval '24 hours')
   where public.is_admin();
$$;

revoke all    on function public.check_console_code(text, text) from public, anon;
revoke all    on function public.change_console_code(text)      from public, anon;
revoke all    on function public.console_code_status()          from public, anon;
grant execute on function public.check_console_code(text, text) to authenticated;
grant execute on function public.change_console_code(text)      to authenticated;
grant execute on function public.console_code_status()          to authenticated;
