-- DCU Timetable — phase 46: a class list can carry more than one grouping, and can be added to.
--
-- RUN ORDER: phase13_roster_allocations.sql → phase23_roster_safeupdate.sql → THIS FILE.
-- Safe to run more than once. Run it BEFORE the console build that sends `p_mode` goes live:
-- until then save_roster has no such parameter and a class list cannot be saved.
--
-- Three changes, all to course_allocations and save_roster:
--
--   1. `extra jsonb` — further groupings beside the lab group: a project team, a studio.
--      One object per student, {"team": "17"}, keys lowercase snake_case, values short text.
--      A new kind of grouping is a new key, never a new column. Phones still read `grp` and
--      ignore `extra`, so nothing on a device changes until a release asks for it.
--
--   2. `grp` may be null. A list of project teams has no lab group to put there. The phone
--      reads a missing group as "no lab group" (mobile/src/core/profile.ts).
--
--   3. save_roster(…, p_mode) — 'replace' (the default, exactly as before) swaps the whole
--      list for the programme. 'add' keeps the students already saved and merges the
--      incoming rows into them: matched by student ID, then by name key; a value the file
--      gives replaces the saved one, a value it leaves empty keeps the saved one; students
--      the list doesn't know yet are added. Nobody is removed.
--
-- The old three-argument function is dropped rather than overloaded: two overloads with a
-- defaulted parameter make PostgREST's named-argument lookup ambiguous.

alter table public.course_allocations add column if not exists extra jsonb not null default '{}'::jsonb;
alter table public.course_allocations alter column grp drop not null;

alter table public.course_allocations drop constraint if exists course_allocations_extra_shape;
alter table public.course_allocations add constraint course_allocations_extra_shape
  check (jsonb_typeof(extra) = 'object' and length(extra::text) <= 1000);

drop function if exists public.save_roster(text, text, jsonb);

create or replace function public.save_roster(
  p_course_key text,
  p_title      text,
  p_members    jsonb,
  p_mode       text default 'replace'
) returns int
  language plpgsql security definer set search_path = '' as $$
declare
  new_version int;
  total int := jsonb_array_length(coalesce(p_members, '[]'::jsonb));
  named int;
  numbered int;
  merging boolean := false;
  matched int := 0;
  added int := 0;
  after_total int;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if coalesce(trim(p_course_key), '') = '' then raise exception 'no course'; end if;
  if total = 0 then raise exception 'a class list needs at least one student'; end if;
  if coalesce(p_mode, '') not in ('replace', 'add') then raise exception 'mode is replace or add'; end if;

  -- Shape of the further groupings, checked on what was sent rather than on what survives.
  if exists (select 1 from jsonb_array_elements(p_members) m
              where m ? 'extra' and jsonb_typeof(m -> 'extra') not in ('object', 'null')) then
    raise exception 'extra groupings must be an object';
  end if;
  if exists (select 1
               from jsonb_array_elements(p_members) m,
                    jsonb_each(case when jsonb_typeof(m -> 'extra') = 'object' then m -> 'extra' else '{}'::jsonb end) e
              where jsonb_typeof(e.value) not in ('string', 'null')) then
    raise exception 'extra groupings must be text';
  end if;

  -- Dropped first: two saves inside one transaction would otherwise meet the first one's
  -- table, which lives until commit.
  drop table if exists pg_temp.incoming;
  create temporary table incoming on commit drop as
  select ord,
         nullif(trim(m ->> 'name_key'), '')                                     as name_key,
         nullif(upper(regexp_replace(coalesce(m ->> 'student_id', ''), '\s', '', 'g')), '') as student_id,
         nullif(trim(m ->> 'group'), '')                                        as grp,
         nullif(trim(m ->> 'subgroup'), '')                                     as subgroup,
         nullif(trim(m ->> 'day'), '')                                          as day,
         nullif(trim(m ->> 'workshop'), '')                                     as workshop,
         nullif(trim(m ->> 'drawing'), '')                                      as drawing,
         coalesce((select jsonb_object_agg(lower(trim(e.key)), trim(e.value #>> '{}'))
                     from jsonb_each(case when jsonb_typeof(m -> 'extra') = 'object' then m -> 'extra' else '{}'::jsonb end) e
                    where nullif(trim(e.value #>> '{}'), '') is not null),
                  '{}'::jsonb)                                                  as extra
    from jsonb_array_elements(p_members) with ordinality as t(m, ord);

  if exists (select 1 from incoming where name_key is null and student_id is null) then
    raise exception 'every student needs a name or a student ID';
  end if;
  if exists (select 1 from incoming where name_key is not null and name_key !~ '^[a-z]+$') then
    raise exception 'name keys are lowercase letters only — the console builds them';
  end if;
  if exists (select 1 from incoming where student_id is not null and student_id !~ '^[A-Z][0-9]{8}$') then
    raise exception 'a student ID is one letter and eight digits';
  end if;
  if exists (select 1 from incoming i, jsonb_each(i.extra) e
              where e.key !~ '^[a-z][a-z0-9_]{0,29}$' or length(e.value #>> '{}') > 60) then
    raise exception 'a grouping name is lowercase letters, digits and underscores, and a value is at most 60 characters';
  end if;
  if exists (select 1 from incoming i where (select count(*) from jsonb_object_keys(i.extra)) > 8) then
    raise exception 'a student can have at most eight extra groupings';
  end if;
  -- A lab group, or some other grouping. A row with neither would say nothing about anyone.
  if exists (select 1 from incoming where grp is null and extra = '{}'::jsonb) then
    raise exception 'every student needs a group or a team';
  end if;
  if exists (select student_id from incoming where student_id is not null
             group by student_id having count(*) > 1) then
    raise exception 'the same student ID appears twice';
  end if;

  -- Adding to a list that isn't there yet is just saving it.
  merging := p_mode = 'add'
             and exists (select 1 from public.roster_members where course_key = p_course_key);

  alter table incoming add column match_key bytea, add column disambig text, add column allocation_key bytea;

  if merging then
    -- 1. by student ID, which is exact.
    update incoming i
       set match_key = m.allocation_key
      from public.roster_members m
     where m.course_key = p_course_key and i.student_id is not null and m.student_id = i.student_id;

    -- 2. by name, for what the ID didn't settle. A saved row with an ID only counts when the
    --    incoming row has no ID, or the same one; two different IDs are two different students.
    if exists (select 1
                 from incoming i
                 join public.roster_members m
                   on m.course_key = p_course_key and m.name_key = i.name_key
                  and (m.student_id is null or i.student_id is null or m.student_id = i.student_id)
                where i.match_key is null and i.name_key is not null
                group by i.ord
               having count(*) > 1) then
      raise exception 'a name in this list matches more than one saved student — add student IDs to tell them apart';
    end if;
    update incoming i
       set match_key = m.allocation_key
      from public.roster_members m
     where i.match_key is null and i.name_key is not null
       and m.course_key = p_course_key and m.name_key = i.name_key
       and (m.student_id is null or i.student_id is null or m.student_id = i.student_id);

    if exists (select match_key from incoming where match_key is not null group by match_key having count(*) > 1) then
      raise exception 'two rows describe the same student';
    end if;
  end if;

  -- A new student's key, as before: their ID, or their place among students of the same name.
  -- When adding, that place starts after the same-name students already saved.
  update incoming i
     set disambig       = coalesce(i.student_id,
                            (d.n + case when merging
                                        then (select count(*) from public.roster_members m
                                               where m.course_key = p_course_key and m.name_key = i.name_key)
                                        else 0 end)::text),
         allocation_key = private.allocation_key(p_course_key, i.name_key,
                            coalesce(i.student_id,
                              (d.n + case when merging
                                          then (select count(*) from public.roster_members m
                                                 where m.course_key = p_course_key and m.name_key = i.name_key)
                                          else 0 end)::text))
    from (select ord, row_number() over (partition by name_key order by ord) as n
            from incoming where match_key is null) d
   where d.ord = i.ord;
  update incoming set allocation_key = match_key where match_key is not null;

  if exists (select allocation_key from incoming group by allocation_key having count(*) > 1) then
    raise exception 'two rows describe the same student';
  end if;

  select count(*) filter (where name_key is not null),
         count(*) filter (where student_id is not null)
    into named, numbered
    from incoming;

  insert into public.rosters (course_key, title, members, created_by)
  values (p_course_key, p_title, total, auth.uid())
  on conflict (course_key) do update
    set title      = excluded.title,
        members    = excluded.members,
        created_by = excluded.created_by,
        created_at = now(),
        version    = public.rosters.version + 1
  returning version into new_version;

  if not merging then
    delete from public.roster_members     where course_key = p_course_key;
    delete from public.course_allocations where course_key = p_course_key;

    insert into public.roster_members (course_key, allocation_key, name_key, student_id, disambig)
    select p_course_key, allocation_key, name_key, student_id, disambig from incoming;

    insert into public.course_allocations
      (course_key, allocation_key, grp, subgroup, day, workshop, drawing, extra)
    select p_course_key, allocation_key, grp, subgroup, day, workshop, drawing, extra from incoming;
    after_total := total;
  else
    -- What the file gives replaces what was saved; what it leaves empty keeps it. Extra
    -- groupings merge key by key, so adding teams leaves a student's studio alone.
    update public.course_allocations a
       set grp      = coalesce(i.grp, a.grp),
           subgroup = coalesce(i.subgroup, a.subgroup),
           day      = coalesce(i.day, a.day),
           workshop = coalesce(i.workshop, a.workshop),
           drawing  = coalesce(i.drawing, a.drawing),
           extra    = a.extra || i.extra
      from incoming i
     where a.course_key = p_course_key and i.match_key is not null and a.allocation_key = i.match_key;
    get diagnostics matched = row_count;

    -- A matched student may gain the half of their identity the saved row lacked.
    update public.roster_members m
       set student_id = coalesce(m.student_id, i.student_id),
           name_key   = coalesce(m.name_key, i.name_key)
      from incoming i
     where m.course_key = p_course_key and i.match_key is not null and m.allocation_key = i.match_key
       and (m.student_id is null or m.name_key is null)
       and not exists (select 1 from public.roster_members o
                        where o.course_key = p_course_key and i.student_id is not null
                          and o.student_id = i.student_id and o.allocation_key <> m.allocation_key);

    insert into public.roster_members (course_key, allocation_key, name_key, student_id, disambig)
    select p_course_key, allocation_key, name_key, student_id, disambig from incoming where match_key is null;
    get diagnostics added = row_count;

    insert into public.course_allocations
      (course_key, allocation_key, grp, subgroup, day, workshop, drawing, extra)
    select p_course_key, allocation_key, grp, subgroup, day, workshop, drawing, extra from incoming where match_key is null;

    select count(*) into after_total from public.roster_members where course_key = p_course_key;
    update public.rosters set members = after_total where course_key = p_course_key;
  end if;

  insert into public.admin_actions (actor_id, action, target, before, after)
  values (auth.uid(), 'roster.save', p_course_key,
          jsonb_build_object('version', new_version - 1),
          jsonb_build_object('version', new_version, 'mode', case when merging then 'add' else 'replace' end,
                             'members', after_total, 'with_names', named, 'with_ids', numbered,
                             'matched', matched, 'added', added));

  return new_version;
end $$;

-- ---------------------------------------------------------------------------
-- Grants — restated, as in every phase since 8
-- ---------------------------------------------------------------------------

revoke all    on function public.save_roster(text, text, jsonb, text) from public, anon;
grant execute on function public.save_roster(text, text, jsonb, text) to authenticated;
