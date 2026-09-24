-- ---------------------------------------------------------------------------
-- Phase 16 — deleting what Ask saved
-- ---------------------------------------------------------------------------
--
-- The console's "Saved" list can remove a split, a programme's lab rotation or its class
-- list. Each goes through a definer function rather than a table write, for the same
-- reasons the saves do: one admin check, one audit row, and — for a class list — the only
-- way in, since rosters carry no write grant at all.
--
-- A deleted class list takes its keys and allocations with it (both cascade from
-- `rosters`). Phones holding a profile from it find the course gone on their next launch
-- and go back to the profile screen (AllocationRefresh.check → .dropped).
--
-- Safe to re-run. Run it in the Supabase SQL editor.

create or replace function public.delete_module_split(p_module_key text, p_activity text)
  returns boolean language plpgsql security definer set search_path = '' as $$
declare
  gone int;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;

  delete from public.module_splits where module_key = p_module_key and activity = p_activity;
  get diagnostics gone = row_count;

  if gone > 0 then
    insert into public.admin_actions (actor_id, action, target, before, after)
    values (auth.uid(), 'split.delete', p_module_key || ' ' || p_activity, null, null);
  end if;
  return gone > 0;
end $$;

create or replace function public.delete_lab_rotation(p_course_key text)
  returns boolean language plpgsql security definer set search_path = '' as $$
declare
  old_version int;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;

  delete from public.lab_rotations where course_key = p_course_key
  returning version into old_version;
  if not found then return false; end if;

  insert into public.admin_actions (actor_id, action, target, before, after)
  values (auth.uid(), 'rotation.delete', p_course_key,
          jsonb_build_object('version', old_version), null);
  return true;
end $$;

create or replace function public.delete_roster(p_course_key text)
  returns boolean language plpgsql security definer set search_path = '' as $$
declare
  old_version int;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;

  delete from public.rosters where course_key = p_course_key
  returning version into old_version;
  if not found then return false; end if;

  insert into public.admin_actions (actor_id, action, target, before, after)
  values (auth.uid(), 'roster.delete', p_course_key,
          jsonb_build_object('version', old_version), null);
  return true;
end $$;

-- A list saved again after a delete must not start back at version 1. A phone that cached
-- version 3, missed the delete, and next launches against a new list that has reached 3
-- would see the same number and keep an allocation from the old list. Continuing from the
-- deleted version keeps "the number moved" meaning "the list changed".
create or replace function private.continue_roster_version() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  select greatest(new.version, max((a.before ->> 'version')::int) + 1) into new.version
    from public.admin_actions a
   where a.action = 'roster.delete' and a.target = new.course_key;
  new.version := coalesce(new.version, 1);
  return new;
end $$;

revoke all on function private.continue_roster_version() from public, anon, authenticated;

drop trigger if exists continue_version on public.rosters;
create trigger continue_version before insert on public.rosters
  for each row execute function private.continue_roster_version();

revoke all    on function public.delete_module_split(text, text) from public, anon;
revoke all    on function public.delete_lab_rotation(text)       from public, anon;
revoke all    on function public.delete_roster(text)             from public, anon;
grant execute on function public.delete_module_split(text, text) to authenticated, service_role;
grant execute on function public.delete_lab_rotation(text)       to authenticated, service_role;
grant execute on function public.delete_roster(text)             to authenticated, service_role;
