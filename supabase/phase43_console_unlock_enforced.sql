-- ---------------------------------------------------------------------------
-- Phase 43 — the console's four-digit code is enforced by the database
-- ---------------------------------------------------------------------------
--
-- Phase 22 made the code lock the console's pages, and said so: "It is not a second
-- password for the database: the session cookie alone reaches the API." Every admin
-- function checked only that the caller was an admin, so anyone holding an admin session
-- token could call set_user_role, set_user_ban, save_roster, list_test_accounts and the rest
-- straight through /rest/v1/rpc/…, never meeting the code.
--
-- Now public.is_admin() means: an admin, in a browser whose console is open (the session
-- named in the token has an unexpired console_sessions row). Everything that asks is_admin()
-- — every admin function and every admin RLS policy — gets the stricter answer from this
-- one change, with no edit to any of them.
--
-- The way in must stay reachable while locked, so the four functions that open the console
-- ask the plain role question instead, private.has_admin_role():
--
--   open_console_session     opens it after an email sign-in
--   enter_console_code       opens it with the code
--   console_session_status   what the lock screen shows
--
-- No code set yet (a fresh project) counts as open, or the first admin could never get far
-- enough to set one.
--
-- What this does not change: the app. A student's own rows are reached by their own
-- policies, not is_admin(), and the mobile app asks is_admin() nowhere. An admin using the
-- app as a student simply has no admin powers there; they live in the console.
--
-- RUN ORDER: after phase 22 and phase 42. Safe to re-run. Run it in the Supabase SQL editor,
-- and sign in to the console again afterwards if it asks.

create schema if not exists private;

-- The old is_admin(): the role alone. Phase 44 adds the two-step requirement here.
create or replace function private.has_admin_role() returns boolean
  language sql stable security definer set search_path = '' as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false);
$$;

revoke all on function private.has_admin_role() from public, anon, authenticated;

create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = '' as $$
  select private.has_admin_role()
     and (
       not exists (select 1 from public.console_code)
       or exists (
         select 1
           from private.console_session() s
           join public.console_sessions c on c.session_id = s.session_id
          where c.user_id = auth.uid()
            and c.unlocked_until > now()
       )
     );
$$;

-- ---------------------------------------------------------------------------
-- The way in, which must work while the console is locked
-- ---------------------------------------------------------------------------

create or replace function public.open_console_session() returns boolean
  language plpgsql security definer set search_path = '' as $$
declare
  s record;
begin
  if not private.has_admin_role() then raise exception 'not allowed'; end if;
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

create or replace function public.enter_console_code(p_code text)
  returns table (status text, attempts_left int)
  language plpgsql security definer set search_path = '' as $$
declare
  s record;
  code text;
  wrong int;
begin
  if not private.has_admin_role() then raise exception 'not allowed'; end if;
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
     and private.has_admin_role();
$$;
