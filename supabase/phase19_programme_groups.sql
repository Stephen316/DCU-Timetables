-- ---------------------------------------------------------------------------
-- Phase 19 — a course's programmes, as groups of it
-- ---------------------------------------------------------------------------
--
-- Six DCU programmes share Engineering's first year: BMED1, CAM1, CE1, ECE1, ME1 and SSE1
-- all study EEG1's modules, and DCU's public timetable lists the same 226 classes against
-- each of them (checked 24 Sep 2026). The console keeps them as one course, `EEG1`, so a
-- lab rotation, a class list or a change for everyone is entered once.
--
-- But some classes split by programme — a lab only Biomedical students attend — and DCU's
-- timetable doesn't say so. So a programme is now a group of its course, alongside the lab
-- groups: a change for `BMED1` reaches BMED1's students whatever their lab group, a change
-- for `C` reaches lab group C whatever their programme, and a change for no group reaches
-- all six.
--
--   course_programmes    the programmes each course covers, with DCU's names. Readable by
--                        anyone signed in: the app lists them so a student sees the
--                        programme they picked, and matches changes for it.
--   timetable_changes    `grp` may now hold one of its course's programme codes.
--   save_timetable_changes  several changes in one transaction — "only BMED1 has this
--                        lab" is a removal for each of the other five, and half of that
--                        saved is a timetable nobody meant.
--
-- The console's copy of the list is `covers` in web/src/lib/proposals/courses.ts.
--
-- Phones from before this phase skip a programme's changes (they match lab groups only),
-- so they see DCU's timetable for that class, as they did before.
--
-- Safe to re-run. Run it in the Supabase SQL editor.

create table if not exists course_programmes (
  code        text primary key check (code ~ '^[A-Z]{2,5}[0-9]$'),
  course_key  text not null,
  name        text not null,
  cao         text check (cao ~ '^DC[0-9]{3}$')
);

create index if not exists course_programmes_course on course_programmes (course_key);

-- Names and CAO codes from dcu.ie's course pages; codes from DCU's timetable, where each
-- is listed as "(Engineering-1)".
insert into course_programmes (code, course_key, name, cao) values
  ('BMED1', 'EEG1', 'Biomedical Engineering',                    'DC197'),
  ('CAM1',  'EEG1', 'Mechanical and Manufacturing Engineering',  'DC195'),
  ('CE1',   'EEG1', 'Common Entry into Engineering',             'DC200'),
  ('ECE1',  'EEG1', 'Electronic and Computer Engineering',       'DC190'),
  ('ME1',   'EEG1', 'Mechatronic Engineering',                   'DC193'),
  ('SSE1',  'EEG1', 'Mechanical and Sustainability Engineering', 'DC194')
on conflict (code) do update
  set course_key = excluded.course_key, name = excluded.name, cao = excluded.cao;

alter table course_programmes enable row level security;
revoke all    on table course_programmes from public, anon, authenticated;
grant  select on table course_programmes to authenticated;

drop policy if exists "read signed in" on course_programmes;
create policy "read signed in" on course_programmes
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- A change's group: a lab group (C), a subgroup (C.2) or a programme (BMED1)
-- ---------------------------------------------------------------------------

alter table timetable_changes drop constraint if exists timetable_changes_grp_check;
alter table timetable_changes add constraint timetable_changes_grp_check
  check (grp ~ '^([A-Z]([.][0-9]{1,2})?|[A-Z]{2,5}[0-9])$');

-- As phase 17's, plus: a programme must be one of the change's course. The pattern alone
-- would let "BMED1" onto a course it isn't part of, where no student would ever match it.
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
    (course_key, grp, kind, module, activity_code, title, dates, start_time, end_time, room, note, created_by)
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
    nullif(trim(p_change ->> 'note'), ''),
    auth.uid()
  )
  returning id into new_id;

  insert into public.admin_actions (actor_id, action, target, before, after)
  values (auth.uid(), 'change.save', new_id::text, null, p_change);
  return new_id;
end $$;

-- All or none: one failing change rolls back the ones before it.
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
  if jsonb_array_length(p_changes) > 20 then raise exception 'at most 20 changes at once'; end if;

  for c in select * from jsonb_array_elements(p_changes) loop
    ids := ids || public.save_timetable_change(c);
  end loop;
  return ids;
end $$;

revoke all    on function public.save_timetable_change(jsonb)   from public, anon;
revoke all    on function public.save_timetable_changes(jsonb)  from public, anon;
grant execute on function public.save_timetable_change(jsonb)   to authenticated, service_role;
grant execute on function public.save_timetable_changes(jsonb)  to authenticated, service_role;
