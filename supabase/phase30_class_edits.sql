-- ---------------------------------------------------------------------------
-- Phase 30 — changing a class's room or lecturer
-- ---------------------------------------------------------------------------
--
-- Phase 17's changes remove a class or add one. This adds a third kind, `edit`, for a class
-- that still runs but somewhere else, or with someone else: it finds its class exactly as a
-- removal does — `module` starting at `start_time` on each date, narrowed by
-- `activity_code` — and puts `room` and/or `staff` on it in place of DCU's.
--
--   staff   the lecturer, as a person reads it ("Dr Jane Smith"). New; an added class may
--           name one too.
--
-- For a group, a programme or everyone, like the other two kinds. An edit has to change
-- something: a room, a lecturer, or both.
--
-- Phones from before this phase skip an edit (they know only the other two kinds), so they
-- show DCU's room and lecturer for that class, as they did before. Phones from after it ask
-- for `staff`, so run this before pushing the app that reads it — until then their change
-- downloads fail and they keep the changes they already have.
--
-- Safe to re-run. Run it in the Supabase SQL editor.

alter table timetable_changes add column if not exists staff text
  check (staff is null or length(btrim(staff)) between 1 and 120);

alter table timetable_changes drop constraint if exists timetable_changes_kind_check;
alter table timetable_changes add constraint timetable_changes_kind_check
  check (kind in ('remove', 'add', 'edit'));

-- Phase 17's unnamed rule, renamed as it widens: an added class says what it is and when it
-- ends; an edit says what it changes; a removal only needs to find its class.
alter table timetable_changes drop constraint if exists timetable_changes_check;
alter table timetable_changes drop constraint if exists timetable_changes_kind_fields;
alter table timetable_changes add constraint timetable_changes_kind_fields check (
  case kind
    when 'add'    then title is not null and end_time is not null and end_time > start_time
    when 'edit'   then room is not null or staff is not null
    else true
  end
);

alter table timetable_changes drop constraint if exists timetable_changes_room_check;
alter table timetable_changes add constraint timetable_changes_room_check
  check (room is null or length(btrim(room)) between 1 and 80);

-- As phase 19's, plus `staff`.
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

revoke all    on function public.save_timetable_change(jsonb) from public, anon;
grant execute on function public.save_timetable_change(jsonb) to authenticated, service_role;
