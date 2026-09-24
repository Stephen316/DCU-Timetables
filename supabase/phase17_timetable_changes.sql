-- ---------------------------------------------------------------------------
-- Phase 17 — removing a class from a timetable, or adding one
-- ---------------------------------------------------------------------------
--
-- DCU's timetable lists every group's slot for every class. The lab rotation already fixes
-- that for its own modules, on the phone, from `lab_rotations`. This is for everything the
-- rotation doesn't say: a lab cancelled for one group, a make-up class, a tutorial that
-- only some groups attend.
--
-- A change belongs to a course (`EEG1`) and, optionally, to one group of it (`C`) or one
-- subgroup (`C.2`). No group means everyone on the course. It lists the dates it applies
-- to — explicit dates rather than a rule, so "every week but reading week" is what is
-- stored, not something each phone works out.
--
--   remove  hides the course's classes of `module` starting at `start_time` on each date.
--           `activity_code` narrows it to one DCU activity (EEG1001[1]OC/P2/01) where two
--           classes of a module share a start.
--   add     puts a class there: `title` (Lab, Tutorial…), `start_time`–`end_time`, `room`.
--
-- No personal data: readable by anyone signed in, like the rotation. Written only through
-- the two functions below, for one admin check and one audit row each.
--
-- Also here: a rotation saved again after a delete continues its version rather than
-- restarting at 1. Phones cache a rotation by version (LabRotationRefresh), so the same
-- reasoning as phase 16's for class lists applies.
--
-- Safe to re-run. Run it in the Supabase SQL editor.

create table if not exists timetable_changes (
  id            uuid primary key default gen_random_uuid(),
  course_key    text not null,
  grp           text check (grp ~ '^[A-Z]([.][0-9]{1,2})?$'),
  kind          text not null check (kind in ('remove', 'add')),
  module        text not null check (module ~ '^[A-Z]{2,6}[0-9]{3,5}$'),
  activity_code text,
  title         text,
  dates         date[] not null check (cardinality(dates) between 1 and 60),
  start_time    text not null check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  end_time      text check (end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  room          text,
  note          text,
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  -- An added class needs to say what it is and when it ends; a removal only needs to find
  -- the class it hides.
  check (kind = 'remove' or (title is not null and end_time is not null and end_time > start_time))
);

create index if not exists timetable_changes_course on timetable_changes (course_key);

alter table timetable_changes enable row level security;
revoke all    on table timetable_changes from public, anon, authenticated;
grant  select on table timetable_changes to authenticated;

drop policy if exists "read signed in" on timetable_changes;
create policy "read signed in" on timetable_changes
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------

create or replace function public.save_timetable_change(p_change jsonb) returns uuid
  language plpgsql security definer set search_path = '' as $$
declare
  new_id uuid;
  d text[];
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;

  select array_agg(distinct x order by x) into d
    from jsonb_array_elements_text(coalesce(p_change -> 'dates', '[]')) x;
  if d is null then raise exception 'a change needs at least one date'; end if;

  insert into public.timetable_changes
    (course_key, grp, kind, module, activity_code, title, dates, start_time, end_time, room, note, created_by)
  values (
    nullif(trim(p_change ->> 'course_key'), ''),
    nullif(upper(trim(p_change ->> 'grp')), ''),
    p_change ->> 'kind',
    upper(trim(p_change ->> 'module')),
    nullif(trim(p_change ->> 'activity_code'), ''),
    nullif(trim(p_change ->> 'title'), ''),
    d::date[],
    p_change ->> 'start_time',
    nullif(p_change ->> 'end_time', ''),
    nullif(trim(p_change ->> 'room'), ''),
    nullif(trim(p_change ->> 'note'), ''),
    auth.uid()
  )
  returning id into new_id;

  insert into public.admin_actions (actor_id, action, target, before, after)
  values (auth.uid(), 'change.save', new_id::text, null, p_change);
  return new_id;
end $$;

create or replace function public.delete_timetable_change(p_id uuid) returns boolean
  language plpgsql security definer set search_path = '' as $$
declare
  gone jsonb;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;

  delete from public.timetable_changes where id = p_id
  returning to_jsonb(timetable_changes.*) into gone;
  if gone is null then return false; end if;

  insert into public.admin_actions (actor_id, action, target, before, after)
  values (auth.uid(), 'change.delete', p_id::text, gone - 'created_by', null);
  return true;
end $$;

revoke all    on function public.save_timetable_change(jsonb)  from public, anon;
revoke all    on function public.delete_timetable_change(uuid) from public, anon;
grant execute on function public.save_timetable_change(jsonb)  to authenticated, service_role;
grant execute on function public.delete_timetable_change(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Rotation versions continue across a delete
-- ---------------------------------------------------------------------------

create or replace function private.continue_rotation_version() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  select greatest(new.version, max((a.before ->> 'version')::int) + 1) into new.version
    from public.admin_actions a
   where a.action = 'rotation.delete' and a.target = new.course_key;
  new.version := coalesce(new.version, 1);
  return new;
end $$;

revoke all on function private.continue_rotation_version() from public, anon, authenticated;

drop trigger if exists continue_version on public.lab_rotations;
create trigger continue_version before insert on public.lab_rotations
  for each row execute function private.continue_rotation_version();
