-- DCU Timetable — phase 60: a timetable change can be for any grouping on the class list, not
-- only a project team.
--
-- RUN ORDER: phase48_team_schedules.sql → THIS FILE. Safe to run more than once. Run it BEFORE
-- saving a schedule for a grouping other than teams; team schedules work the same either way.
--
-- Why: a class test allocation gives each student a sitting — "S143, 18/11/2026, 13:00".
-- That is a grouping like a team: the class list stores it per student in
-- course_allocations.extra, under its own key ("sitting_group"), so it never overwrites the
-- student's project team. Phase 48 could only aim a change at `TEAM:<id>`.
--
-- A change for a grouping is written in `grp` as the grouping's key in capitals, a colon, and
-- its ID in capitals: SITTING_GROUP:S143-18NOV-1300. TEAM:A1.A is the same rule with the key
-- "team", so every team change already saved stays valid. A phone that doesn't know a key
-- reads it as a group it isn't in and ignores it.
--
--   1. timetable_changes.grp accepts <KEY>:<id>.
--   2. save_timetable_change checks the ID is on the course's class list under that key, as
--      phase 48 checked teams: an ID that matches no student would be saved and shown to nobody.
--   3. save_team_schedule takes slots for any one grouping, and replaces the grouping slots
--      saved before under the same module and class title.

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'save_team_schedule'
                    and pronamespace = 'public'::regnamespace) then
    raise exception 'run phase48_team_schedules.sql first: save_team_schedule does not exist yet';
  end if;
end $$;

alter table public.timetable_changes drop constraint if exists timetable_changes_grp_check;
alter table public.timetable_changes add constraint timetable_changes_grp_check
  check (grp ~ '^([A-Z]([.][0-9]{1,2})?|[A-Z]{2,5}[0-9]|[A-Z][A-Z0-9_]{0,29}:[A-Z0-9._-]{1,30})$');

-- As phase 48's, with the team check widened to any grouping.
create or replace function public.save_timetable_change(p_change jsonb) returns uuid
  language plpgsql security definer set search_path = '' as $$
declare
  new_id uuid;
  d text[];
  course text := nullif(trim(p_change ->> 'course_key'), '');
  target text := nullif(upper(trim(p_change ->> 'grp')), '');
  grouping text;
  member text;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;

  select array_agg(distinct x order by x) into d
    from jsonb_array_elements_text(coalesce(p_change -> 'dates', '[]')) x;
  if d is null then raise exception 'a change needs at least one date'; end if;

  if target ~ '^[A-Z]{2,5}[0-9]$' and not exists (
    select 1 from public.course_programmes p where p.code = target and p.course_key = course
  ) then
    raise exception '% is not a programme of %', target, course;
  end if;

  if position(':' in coalesce(target, '')) > 0 then
    grouping := lower(split_part(target, ':', 1));
    member := substr(target, length(grouping) + 2);
    if not exists (
      select 1 from public.course_allocations a
       where a.course_key = course
         and upper(regexp_replace(coalesce(a.extra ->> grouping, ''), '\s', '', 'g')) = member
    ) then
      raise exception '% % is not on the class list for %', replace(grouping, '_', ' '), member, course;
    end if;
  end if;

  insert into public.timetable_changes
    (course_key, grp, kind, module, activity_code, title, dates, start_time, end_time, room, staff, note, created_by)
  values (
    course,
    target,
    p_change ->> 'kind',
    upper(trim(p_change ->> 'module')),
    nullif(trim(p_change ->> 'activity_code'), ''),
    nullif(trim(p_change ->> 'title'), ''),
    d::date[],
    p_change ->> 'start_time',
    nullif(p_change ->> 'end_time', ''),
    nullif(trim(p_change ->> 'room'), ''),
    nullif(trim(p_change ->> 'staff'), ''),
    nullif(trim(p_change ->> 'note'), ''),
    auth.uid()
  )
  returning id into new_id;

  insert into public.admin_actions (actor_id, action, target, before, after)
  values (auth.uid(), 'change.save', new_id::text, null, p_change);
  return new_id;
end $$;

-- As phase 48's, for any one grouping: every slot is an added class for the same grouping
-- key, and what it replaces is that key's slots under the same module and title. A change for
-- everyone, a lab group or a programme is never touched, and neither is another grouping's.
create or replace function public.save_team_schedule(
  p_course_key text,
  p_module     text,
  p_title      text,
  p_changes    jsonb
) returns table (replaced int, saved int)
  language plpgsql security definer set search_path = '' as $$
declare
  removed int;
  ids uuid[];
  prefix text;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if coalesce(trim(p_course_key), '') = '' or coalesce(trim(p_module), '') = '' or coalesce(trim(p_title), '') = '' then
    raise exception 'a schedule needs a course, a module and a title';
  end if;
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0 then
    raise exception 'no changes';
  end if;

  prefix := substring(upper(coalesce(p_changes -> 0 ->> 'grp', '')) from '^[A-Z][A-Z0-9_]{0,29}:');
  if prefix is null then raise exception 'a schedule is slots for a team or another grouping'; end if;

  -- Every change must be an added class for this grouping, course, module and title, so this
  -- function can't be used to write anything else.
  if exists (select 1 from jsonb_array_elements(p_changes) c
              where coalesce(c ->> 'kind', '') <> 'add'
                 or left(upper(coalesce(c ->> 'grp', '')), length(prefix)) <> prefix
                 or c ->> 'course_key' is distinct from p_course_key
                 or upper(coalesce(c ->> 'module', '')) <> upper(p_module)
                 or lower(btrim(coalesce(c ->> 'title', ''))) <> lower(btrim(p_title))) then
    raise exception 'a schedule is added classes for one grouping, all of this course, module and title';
  end if;

  delete from public.timetable_changes t
   where t.course_key = p_course_key and t.module = upper(p_module) and t.kind = 'add'
     and lower(btrim(t.title)) = lower(btrim(p_title)) and left(t.grp, length(prefix)) = prefix;
  get diagnostics removed = row_count;

  ids := public.save_timetable_changes(p_changes);

  insert into public.admin_actions (actor_id, action, target, before, after)
  values (auth.uid(), 'schedule.save', p_course_key || ' ' || upper(p_module),
          jsonb_build_object('replaced', removed),
          jsonb_build_object('saved', coalesce(array_length(ids, 1), 0), 'title', p_title, 'grouping', prefix));

  return query select removed, coalesce(array_length(ids, 1), 0);
end $$;

revoke all    on function public.save_timetable_change(jsonb) from public, anon;
revoke all    on function public.save_team_schedule(text, text, text, jsonb) from public, anon;
grant execute on function public.save_timetable_change(jsonb) to authenticated, service_role;
grant execute on function public.save_team_schedule(text, text, text, jsonb) to authenticated;
