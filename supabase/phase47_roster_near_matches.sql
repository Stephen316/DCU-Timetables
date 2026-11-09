-- DCU Timetable — phase 47: adding to a class list asks about near-miss names.
--
-- RUN ORDER: phase46_roster_groupings.sql → THIS FILE. Safe to run more than once.
-- Run it BEFORE the console build that calls roster_merge_preview goes live.
--
-- Adding a file to an existing class list matches students by ID, then by name key (the
-- letters of given name then surname). A name written differently in the two files — an extra
-- middle name, a stray initial, one wrong letter, surname first — matched nobody, so the
-- student was added a second time with no lab group. Nothing said so.
--
--   roster_merge_preview(course, members)  For each incoming row that matches nobody exactly,
--       the saved students whose names look like it: same letters in another order, within one
--       or two letters (by length), or the same start and end with something extra between.
--       Admin only. Returns the saved name key — letters only, never a name as written — and
--       the saved student's group, so the administrator can say "same person" or "different".
--
--   save_roster(…, 'add')  A member may now carry `match_name_key`: the saved student the
--       administrator confirmed it is. It is tried first, before ID and name, and refuses if
--       that key is not on the list exactly once.
--
-- Nothing is decided by the database or by a model: it only finds the candidates.

create extension if not exists fuzzystrmatch with schema extensions;

create or replace function private.sorted_letters(p text) returns text
  language sql immutable set search_path = '' as $$
  select coalesce(string_agg(c, '' order by c), '') from regexp_split_to_table(coalesce(p, ''), '') as c
$$;
revoke all on function private.sorted_letters(text) from public, anon, authenticated;

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
                  '{}'::jsonb)                                                  as extra,
         nullif(lower(trim(m ->> 'match_name_key')), '')                        as match_name_key
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
  if exists (select 1 from incoming where match_name_key is not null and match_name_key !~ '^[a-z]+$') then
    raise exception 'a chosen match is a name key — lowercase letters only';
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
    -- 0. the administrator's answer, for names that looked alike but didn't match. It must
    --    point at exactly one saved student.
    if exists (select 1 from incoming i
                where i.match_name_key is not null
                  and (select count(*) from public.roster_members m
                        where m.course_key = p_course_key and m.name_key = i.match_name_key) <> 1) then
      raise exception 'a match you chose is no longer on the saved list, or more than one saved student has that name';
    end if;
    update incoming i
       set match_key = m.allocation_key
      from public.roster_members m
     where i.match_name_key is not null
       and m.course_key = p_course_key and m.name_key = i.match_name_key;

    -- 1. by student ID, which is exact.
    update incoming i
       set match_key = m.allocation_key
      from public.roster_members m
     where i.match_key is null and m.course_key = p_course_key
       and i.student_id is not null and m.student_id = i.student_id;

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

-- ---------------------------------------------------------------------------
-- roster_merge_preview
-- ---------------------------------------------------------------------------
--
-- `ord` is the 1-based position in p_members, which is how the console finds the row again.

create or replace function public.roster_merge_preview(
  p_course_key text,
  p_members    jsonb
) returns table (ord bigint, candidate text, grp text, subgroup text, reason text)
  language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if coalesce(trim(p_course_key), '') = '' then raise exception 'no course'; end if;

  return query
  with inc as (
    select t.ord,
           nullif(trim(m ->> 'name_key'), '') as nk,
           nullif(upper(regexp_replace(coalesce(m ->> 'student_id', ''), '\s', '', 'g')), '') as sid
      from jsonb_array_elements(p_members) with ordinality as t(m, ord)
  ),
  -- What save_roster would match without being asked: the same ID, or the same name key
  -- where the IDs don't disagree.
  exact as (
    select i.ord, r.allocation_key
      from inc i
      join public.roster_members r
        on r.course_key = p_course_key
       and ((i.sid is not null and r.student_id = i.sid)
         or (i.nk is not null and r.name_key = i.nk
             and (r.student_id is null or i.sid is null or r.student_id = i.sid)))
  ),
  near as (
    select i.ord, r.name_key as cand, a.grp as g, a.subgroup as sg,
           extensions.levenshtein(i.nk, r.name_key) as dist,
           case when private.sorted_letters(i.nk) = private.sorted_letters(r.name_key)
                  then 'the same letters in a different order'
                when extensions.levenshtein(i.nk, r.name_key) <=
                       case when least(length(i.nk), length(r.name_key)) >= 8 then 2 else 1 end
                  then 'spelled slightly differently'
                else 'a middle name or initial added or missing'
           end as why
      from inc i
      join public.roster_members r on r.course_key = p_course_key and r.name_key is not null
      join public.course_allocations a on a.course_key = r.course_key and a.allocation_key = r.allocation_key
     where i.nk is not null
       and i.ord not in (select e.ord from exact e)
       and r.allocation_key not in (select e.allocation_key from exact e)
       and r.name_key <> i.nk
       and length(i.nk) between 5 and 100 and length(r.name_key) between 5 and 100
       and (
             private.sorted_letters(i.nk) = private.sorted_letters(r.name_key)
          or extensions.levenshtein(i.nk, r.name_key) <=
               case when least(length(i.nk), length(r.name_key)) >= 8 then 2 else 1 end
          or (least(length(i.nk), length(r.name_key)) >= 8
              and length(i.nk) <> length(r.name_key)
              and left(i.nk, 4) = left(r.name_key, 4) and right(i.nk, 4) = right(r.name_key, 4))
       )
  ),
  ranked as (
    select n.*, row_number() over (partition by n.ord order by n.dist, n.cand) as rn from near n
  )
  select k.ord, k.cand, k.g, k.sg, k.why from ranked k where k.rn <= 3 order by k.ord, k.rn;
end $$;

revoke all    on function public.roster_merge_preview(text, jsonb) from public, anon;
grant execute on function public.roster_merge_preview(text, jsonb) to authenticated;
