-- DCU Timetable — phase 48: a timetable change can be for one project team.
--
-- RUN ORDER: phase17 → phase19 → phase30_class_edits.sql → phase46_roster_groupings.sql → THIS FILE.
-- Safe to run more than once. Run it BEFORE the console build that saves a team schedule.
--
-- Why: a presentation schedule gives each team its own slot — "A1.a, 11/11/2026, 2pm, S378".
-- That is an added class for one team, and a change could only be for everyone, a lab group
-- or a programme. Teams are stored per student in course_allocations.extra (phase 46).
--
-- A team is written in `grp` as `TEAM:` and its ID in capitals: TEAM:A1.A. Nothing else about
-- the table changes, and a phone that doesn't know teams yet reads it as a group it isn't in
-- and ignores it — it neither breaks nor shows a class to the wrong person.
--
--   1. timetable_changes.grp accepts TEAM:<id>.
--   2. save_timetable_change checks the team is on the course's class list, as it checks a
--      programme belongs to the course: an ID that matches no student would be saved and
--      then shown to nobody.
--   3. save_timetable_changes takes up to 100 changes, not 20 — a schedule is one per team.
--   4. save_team_schedule replaces: it removes the team slots already saved for the same
--      module and class title and saves these, as one step. Uploading a corrected schedule
--      then replaces the first rather than adding a second slot for every team.

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'timetable_changes' and column_name = 'staff') then
    raise exception 'run phase30_class_edits.sql first: timetable_changes has no staff column yet';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'course_allocations' and column_name = 'extra') then
    raise exception 'run phase46_roster_groupings.sql first: course_allocations has no extra column yet';
  end if;
end $$;

alter table public.timetable_changes drop constraint if exists timetable_changes_grp_check;
alter table public.timetable_changes add constraint timetable_changes_grp_check
  check (grp ~ '^([A-Z]([.][0-9]{1,2})?|[A-Z]{2,5}[0-9]|TEAM:[A-Z0-9._-]{1,30})$');

-- As phase 30's, plus the team check.
create or replace function public.save_timetable_change(p_change jsonb) returns uuid
  language plpgsql security definer set search_path = '' as $$
declare
  new_id uuid;
  d text[];
  course text := nullif(trim(p_change ->> 'course_key'), '');
  target text := nullif(upper(trim(p_change ->> 'grp')), '');
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

  if target like 'TEAM:%' and not exists (
    select 1 from public.course_allocations a
     where a.course_key = course and upper(a.extra ->> 'team') = substr(target, 6)
  ) then
    raise exception 'team % is not on the class list for %', substr(target, 6), course;
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

-- All or none: one failing change rolls back the ones before it. As phase 19's, with the
-- limit raised from 20 to 100.
create or replace function public.save_timetable_changes(p_changes jsonb) returns uuid[]
  language plpgsql security definer set search_path = '' as $$
declare
  ids uuid[] := '{}';
  c jsonb;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0 then
    raise exception 'no changes';
  end if;
  if jsonb_array_length(p_changes) > 100 then raise exception 'at most 100 changes at once'; end if;

  for c in select * from jsonb_array_elements(p_changes) loop
    ids := ids || public.save_timetable_change(c);
  end loop;
  return ids;
end $$;

-- A team schedule, replacing the one saved before for the same module and class title.
-- Only team slots are removed: a change for everyone, a group or a programme is left alone,
-- and so is a team's slot for a differently named class.
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
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if coalesce(trim(p_course_key), '') = '' or coalesce(trim(p_module), '') = '' or coalesce(trim(p_title), '') = '' then
    raise exception 'a team schedule needs a course, a module and a title';
  end if;
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0 then
    raise exception 'no changes';
  end if;
  -- Every change must be an added class for a team of this course and module, so this
  -- function can't be used to write anything else.
  if exists (select 1 from jsonb_array_elements(p_changes) c
              where coalesce(c ->> 'kind', '') <> 'add'
                 or upper(coalesce(c ->> 'grp', '')) !~ '^TEAM:'
                 or c ->> 'course_key' is distinct from p_course_key
                 or upper(coalesce(c ->> 'module', '')) <> upper(p_module)
                 or lower(btrim(coalesce(c ->> 'title', ''))) <> lower(btrim(p_title))) then
    raise exception 'a team schedule is added classes for teams, all of this course, module and title';
  end if;

  delete from public.timetable_changes t
   where t.course_key = p_course_key and t.module = upper(p_module) and t.kind = 'add'
     and lower(btrim(t.title)) = lower(btrim(p_title)) and t.grp like 'TEAM:%';
  get diagnostics removed = row_count;

  ids := public.save_timetable_changes(p_changes);

  insert into public.admin_actions (actor_id, action, target, before, after)
  values (auth.uid(), 'schedule.save', p_course_key || ' ' || upper(p_module),
          jsonb_build_object('replaced', removed),
          jsonb_build_object('saved', coalesce(array_length(ids, 1), 0), 'title', p_title));

  return query select removed, coalesce(array_length(ids, 1), 0);
end $$;

revoke all    on function public.save_timetable_change(jsonb)  from public, anon;
revoke all    on function public.save_timetable_changes(jsonb) from public, anon;
revoke all    on function public.save_team_schedule(text, text, text, jsonb) from public, anon;
grant execute on function public.save_timetable_change(jsonb)  to authenticated, service_role;
grant execute on function public.save_timetable_changes(jsonb) to authenticated, service_role;
grant execute on function public.save_team_schedule(text, text, text, jsonb) to authenticated;
