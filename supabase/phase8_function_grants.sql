-- ---------------------------------------------------------------------------
-- Phase 8 — take EXECUTE away from PUBLIC, and guard assign_pi
-- ---------------------------------------------------------------------------
--
-- Postgres grants EXECUTE on every new function to PUBLIC. Phase 2 wrote:
--
--   revoke all on function public.set_user_role(uuid, text) from anon;
--
-- which does nothing, because the grant that lets `anon` in is the one held by PUBLIC, and
-- revoking from a role does not touch it. All 13 functions were anon-callable. Same shape
-- as the phase 7 policy bug: a line that reads correctly and has no effect.
--
-- Most were harmless — they guard themselves (`set_user_role`, `set_user_ban` and
-- `find_by_pi` check is_admin(); `verify_deadline` checks is_trusted()), or they are
-- trigger functions that error when called directly.
--
-- `assign_pi` was not. It has no guard, and its last line is:
--
--   return (select pi from public.profiles where id = target);   -- already had one
--
-- so any caller, signed in or not, could hand it a uuid and get that person's PI back. A
-- PI is what a student shares with you privately to be granted trust, so it should not be
-- obtainable by anyone holding a uuid — and uuids do leak: `verified_by` is exposed in
-- `module_deadlines_public`.
--
-- Safe to re-run. Run it in the Supabase SQL editor.

begin;

-- ---------------------------------------------------------------------------
-- 1. assign_pi gets the guard it never had
-- ---------------------------------------------------------------------------
--
-- Yourself, or an admin acting for someone else. Nothing else. The rest of the body is
-- unchanged from phase 0.

create or replace function public.assign_pi(target uuid) returns text
  language plpgsql security definer set search_path = '' as $$
declare candidate text;
begin
  if target is distinct from auth.uid() and not public.is_admin() then
    raise exception 'not allowed';
  end if;

  for _attempt in 1..50 loop
    candidate := public.new_pi();
    begin
      update public.profiles set pi = candidate where id = target and pi is null;
      if found then return candidate; end if;
      return (select pi from public.profiles where id = target);   -- already had one
    exception when unique_violation then
      -- collided with an existing PI; draw again. 24M values, so this is rare.
    end;
  end loop;
  raise exception 'could not allocate a free PI after 50 attempts';
end $$;

-- ---------------------------------------------------------------------------
-- 2. new_pi gets a fixed search_path, like every other function here
-- ---------------------------------------------------------------------------
--
-- It only calls built-ins, so the risk was theoretical — but "every function pins its
-- search_path" is a rule worth having no exceptions to, because the exception is what you
-- stop noticing.

alter function public.new_pi() set search_path = '';

-- ---------------------------------------------------------------------------
-- 3. Trigger functions are not API
-- ---------------------------------------------------------------------------
--
-- EXECUTE on a trigger function is checked when the trigger is created, not when it fires,
-- so removing it does not affect the triggers themselves.

revoke all on function public.handle_new_user()          from public, anon, authenticated;
revoke all on function public.guard_profile_update()     from public, anon, authenticated;
revoke all on function public.anonymise_contributions()  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Internal helpers
-- ---------------------------------------------------------------------------

revoke all on function public.new_pi()            from public, anon, authenticated;
revoke all on function public.assign_pi(uuid)     from public, anon;
grant execute on function public.assign_pi(uuid)  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The five RPCs the clients actually call
-- ---------------------------------------------------------------------------
--
--   delete_own_account   iOS app
--   find_by_pi           console
--   set_user_ban         console
--   set_user_role        console
--   verify_deadline      console
--
-- Each one already refuses to act for the wrong caller. This makes it refuse to answer the
-- phone as well — an unauthenticated caller should not be able to probe an admin RPC and
-- read the difference between "not allowed" and "no such user".

revoke all on function public.delete_own_account()                          from public, anon;
revoke all on function public.find_by_pi(text)                              from public, anon;
revoke all on function public.set_user_ban(uuid, timestamptz, text)         from public, anon;
revoke all on function public.set_user_role(uuid, text)                     from public, anon;
revoke all on function public.verify_deadline(uuid, text)                   from public, anon;

grant execute on function public.delete_own_account()                  to authenticated, service_role;
grant execute on function public.find_by_pi(text)                      to authenticated, service_role;
grant execute on function public.set_user_ban(uuid, timestamptz, text) to authenticated, service_role;
grant execute on function public.set_user_role(uuid, text)             to authenticated, service_role;
grant execute on function public.verify_deadline(uuid, text)           to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. The three predicates STAY callable by anon — on purpose
-- ---------------------------------------------------------------------------
--
-- `is_admin()`, `is_banned()` and `is_trusted()` are referenced by RLS policies, and a
-- policy expression is evaluated as the *calling* role. Revoke EXECUTE from anon and every
-- policy mentioning them raises "permission denied for function" instead of filtering — an
-- anonymous read of cancellation_reports would error rather than return [].
--
-- They are safe to expose: each reports only on the caller, and returns false for anon.
-- The linter will keep flagging all three. That warning is expected here.

revoke all   on function public.is_admin()   from public;
revoke all   on function public.is_banned()  from public;
revoke all   on function public.is_trusted() from public;
grant execute on function public.is_admin()   to anon, authenticated, service_role;
grant execute on function public.is_banned()  to anon, authenticated, service_role;
grant execute on function public.is_trusted() to anon, authenticated, service_role;

commit;
