-- ---------------------------------------------------------------------------
-- Phase 14 — let sign-up assign a PI again
-- ---------------------------------------------------------------------------
--
-- Phase 8 gave assign_pi the guard it lacked: yourself, or an admin. Correct for callers
-- over the API — and fatal for the one caller that is not one. `handle_new_user` runs as
-- a trigger on auth.users while the account is being created. Nobody is signed in yet, so
-- auth.uid() is null, "target is distinct from auth.uid()" is true, and the guard raises
-- `not allowed` inside the insert. Supabase Auth reports that as "Database error saving
-- new user", and the account is never created.
--
-- So since phase 8, no student could sign up. It went unnoticed because the only account
-- in the database was created before it. Found on 23 Sep 2026 while testing phase 13:
-- inserting a test user failed at exactly this line.
--
-- The fix is not to loosen the guard. An `auth.uid() is null` carve-out would be safe only
-- for as long as anon stays revoked, which is the kind of condition phase 8 exists because
-- of. Instead the allocation moves into a function no API role can reach, the trigger
-- calls that, and the public function keeps its guard in front of the same code.
--
-- Safe to re-run. Run it in the Supabase SQL editor.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.allocate_pi(target uuid) returns text
  language plpgsql security definer set search_path = '' as $$
declare candidate text;
begin
  for _attempt in 1..50 loop
    candidate := public.new_pi();
    begin
      update public.profiles set pi = candidate where id = target and pi is null;
      if found then return candidate; end if;
      return (select pi from public.profiles where id = target);   -- already had one
    exception when unique_violation then
      null;
    end;
  end loop;
  raise exception 'could not allocate a free PI after 50 attempts';
end $$;

revoke all on function private.allocate_pi(uuid) from public, anon, authenticated;

create or replace function public.assign_pi(target uuid) returns text
  language plpgsql security definer set search_path = '' as $$
begin
  if target is distinct from auth.uid() and not public.is_admin() then
    raise exception 'not allowed';
  end if;
  return private.allocate_pi(target);
end $$;

create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  perform private.allocate_pi(new.id);
  return new;
end $$;

revoke all    on function public.assign_pi(uuid) from public, anon;
grant execute on function public.assign_pi(uuid) to authenticated;
revoke all    on function public.handle_new_user() from public, anon, authenticated;
