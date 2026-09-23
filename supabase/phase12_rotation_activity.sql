-- ---------------------------------------------------------------------------
-- Phase 12 — a lab session's activity belongs to the session, not the module
-- ---------------------------------------------------------------------------
--
-- EEG1001 runs two columns of the rotation: Workshop and Drawing. A module has one name,
-- but not one activity. The app's bundled rotation stored the activity per module, could
-- not represent that, and was bent to fit — Drawing filed under EEG1004 — so 35 of its 67
-- sessions carried the wrong module until 23 Sep 2026. See docs/ENGINEERING_LABS.md.
--
-- This table had the same gap: nothing recorded which column a session came from, so a
-- saved EEG1001 Workshop and EEG1001 Drawing on the same afternoon were indistinguishable.
--
-- Nullable, because a rotation saved before this phase has no activity to backfill, and
-- inventing one would repeat the original mistake in a new place.
--
-- Safe to re-run. Run it in the Supabase SQL editor.

alter table lab_rotation_sessions add column if not exists activity text;

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
    (rotation_id, week, date, day, start_time, end_time, module, activity, groups, room)
  select rot,
         (s ->> 'week')::int,
         nullif(s ->> 'date', '')::date,
         s ->> 'day',
         s ->> 'start',
         s ->> 'end',
         s ->> 'module',
         s ->> 'activity',
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

-- Restated rather than assumed. `create or replace` keeps existing privileges, but this
-- project has been bitten twice by grants that read correctly and did something else.
revoke all   on function public.save_lab_rotation(text, text, jsonb) from public, anon;
grant execute on function public.save_lab_rotation(text, text, jsonb) to authenticated, service_role;
