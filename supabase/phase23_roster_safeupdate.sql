-- ---------------------------------------------------------------------------
-- Phase 23 — a class list saves through the API
-- ---------------------------------------------------------------------------
--
-- Phase 13's save_roster never saved anything from the console. Supabase loads
-- pg_safeupdate for every API request, and it refuses an UPDATE with no WHERE clause —
-- "UPDATE requires a WHERE clause" — even on a temporary table, even inside a security
-- definer function. The SQL editor doesn't load it, which is why the function passed there.
--
-- The offending statement filled allocation_key across the whole of `incoming`. It is now
-- computed in the joined UPDATE that sets disambig, which has a WHERE of its own. Nothing
-- else changes.

create or replace function public.save_roster(
  p_course_key text,
  p_title      text,
  p_members    jsonb
) returns int
  language plpgsql security definer set search_path = '' as $$
declare
  new_version int;
  total int := jsonb_array_length(coalesce(p_members, '[]'::jsonb));
  named int;
  numbered int;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if coalesce(trim(p_course_key), '') = '' then raise exception 'no course'; end if;
  if total = 0 then raise exception 'a class list needs at least one student'; end if;

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
         nullif(trim(m ->> 'drawing'), '')                                      as drawing
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
  if exists (select 1 from incoming where grp is null) then
    raise exception 'every student needs a group';
  end if;
  if exists (select student_id from incoming where student_id is not null
             group by student_id having count(*) > 1) then
    raise exception 'the same student ID appears twice';
  end if;

  alter table incoming add column disambig text, add column allocation_key bytea;
  update incoming i
     set disambig       = coalesce(i.student_id, d.n::text),
         allocation_key = private.allocation_key(p_course_key, i.name_key, coalesce(i.student_id, d.n::text))
    from (select ord, row_number() over (partition by name_key order by ord) as n
            from incoming) d
   where d.ord = i.ord;

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

  delete from public.roster_members     where course_key = p_course_key;
  delete from public.course_allocations where course_key = p_course_key;

  insert into public.roster_members (course_key, allocation_key, name_key, student_id, disambig)
  select p_course_key, allocation_key, name_key, student_id, disambig from incoming;

  insert into public.course_allocations
    (course_key, allocation_key, grp, subgroup, day, workshop, drawing)
  select p_course_key, allocation_key, grp, subgroup, day, workshop, drawing from incoming;

  insert into public.admin_actions (actor_id, action, target, before, after)
  values (auth.uid(), 'roster.save', p_course_key,
          jsonb_build_object('version', new_version - 1),
          jsonb_build_object('version', new_version, 'members', total,
                             'with_names', named, 'with_ids', numbered));

  return new_version;
end $$;

-- ---------------------------------------------------------------------------
-- Grants — restated, as in every phase since 8
-- ---------------------------------------------------------------------------

revoke all    on function public.save_roster(text, text, jsonb) from public, anon;
grant execute on function public.save_roster(text, text, jsonb) to authenticated;
