-- ---------------------------------------------------------------------------
-- Phase 10 — lab rotations, so an amendment doesn't need an App Store release
-- ---------------------------------------------------------------------------
--
-- `EngineeringLabRotation.json` is read by `LabRotation.bundled()` from the app bundle and
-- nowhere else. When the School moves a group or changes a room in week 6, fixing it today
-- means a new build and a review queue — days, for a data correction.
--
-- No personal data lives here: group letters against weeks, modules and rooms. So unlike
-- `roster_members` this is readable by anyone signed in and carries none of the retention
-- or deletion obligations in CSV_PIPELINE.md §2.
--
-- The app keeps the bundled JSON as a fallback for first launch and for offline, and
-- prefers this when it can reach it. That part is an iOS change and is not done yet — until
-- it is, this table is written by the console and read by nothing.
--
-- Safe to re-run. Run it in the Supabase SQL editor.

create table if not exists lab_rotations (
  id          uuid primary key default gen_random_uuid(),
  course_key  text not null,
  title       text,
  -- Bumped on every save. The app compares it against what it has cached rather than
  -- re-downloading a few hundred rows at every launch.
  version     int  not null default 1,
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now(),
  unique (course_key)
);

create table if not exists lab_rotation_sessions (
  id          uuid primary key default gen_random_uuid(),
  rotation_id uuid not null references lab_rotations (id) on delete cascade,
  week        int,
  date        date,
  day         text,
  start_time  text,
  end_time    text,
  module      text,
  -- Several groups attend one session, so this is a list rather than a row per group.
  groups      text[] not null default '{}',
  room        text
);

create index if not exists lab_rotation_sessions_rotation on lab_rotation_sessions (rotation_id);

alter table lab_rotations         enable row level security;
alter table lab_rotation_sessions enable row level security;

drop policy if exists "read signed in" on lab_rotations;
drop policy if exists "admin write"    on lab_rotations;
create policy "read signed in" on lab_rotations
  for select to authenticated using (true);
create policy "admin write" on lab_rotations
  for all to authenticated
  using      ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "read signed in" on lab_rotation_sessions;
drop policy if exists "admin write"    on lab_rotation_sessions;
create policy "read signed in" on lab_rotation_sessions
  for select to authenticated using (true);
create policy "admin write" on lab_rotation_sessions
  for all to authenticated
  using      ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Saving a rotation replaces it wholesale, in one transaction
-- ---------------------------------------------------------------------------
--
-- A rotation is only meaningful complete. Half of one on a student's phone is worse than
-- none, because the missing half looks like a free afternoon rather than like an error.
--
-- The proposal you accepted in the console is the review step: model output reaches this
-- function only after a person has looked at it. The audit row records what was accepted,
-- so a wrong room six weeks later can be traced to the import that introduced it.

create or replace function public.save_lab_rotation(
  p_course_key text,
  p_title      text,
  p_sessions   jsonb
) returns int
  language plpgsql security definer set search_path = '' as $$
declare
  rot uuid;
  new_version int;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if jsonb_array_length(p_sessions) = 0 then raise exception 'a rotation needs at least one session'; end if;

  insert into public.lab_rotations (course_key, title, created_by)
  values (p_course_key, p_title, auth.uid())
  on conflict (course_key) do update
    set title      = excluded.title,
        created_by = excluded.created_by,
        created_at = now(),
        version    = public.lab_rotations.version + 1
  returning id, version into rot, new_version;

  delete from public.lab_rotation_sessions where rotation_id = rot;

  insert into public.lab_rotation_sessions
    (rotation_id, week, date, day, start_time, end_time, module, groups, room)
  select rot,
         (s ->> 'week')::int,
         nullif(s ->> 'date', '')::date,
         s ->> 'day',
         s ->> 'start',
         s ->> 'end',
         s ->> 'module',
         coalesce(
           (select array_agg(g #>> '{}') from jsonb_array_elements(s -> 'groups') g),
           '{}'
         ),
         s ->> 'room'
    from jsonb_array_elements(p_sessions) s;

  insert into public.admin_actions (actor_id, action, target, before, after)
  values (auth.uid(), 'rotation.save', p_course_key,
          jsonb_build_object('version', new_version - 1),
          jsonb_build_object('version', new_version,
                             'sessions', jsonb_array_length(p_sessions)));

  return new_version;
end $$;

revoke all   on function public.save_lab_rotation(text, text, jsonb) from public, anon;
grant execute on function public.save_lab_rotation(text, text, jsonb) to authenticated, service_role;
