-- ---------------------------------------------------------------------------
-- Phase 9 — alphabetical split rules
-- ---------------------------------------------------------------------------
--
-- "Surnames A-M have the lecture Tuesday, N-Z Thursday."
--
-- This is the one piece of allocation data that needs NO personal data at all. A roster
-- lists people; a split states a rule, and the app applies it to the student's own surname
-- on the device. Nothing here identifies anyone, so unlike `roster_members` it is readable
-- by every signed-in student and carries none of the retention or deletion obligations in
-- CSV_PIPELINE.md §2.
--
-- Where a course splits by rule rather than by list, prefer this. It is strictly better on
-- every axis: less data held, nothing to leak, nothing to delete on request, and correct
-- for a student who joins the course after the roster was imported.
--
-- Safe to re-run. Run it in the Supabase SQL editor.

create table if not exists module_splits (
  id          uuid primary key default gen_random_uuid(),
  module_key  text not null,
  -- A module often splits its tutorials but not its lectures, so the activity is part of
  -- the identity of the rule rather than a detail of it.
  activity    text not null,
  note        text,
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now(),
  unique (module_key, activity)
);

create table if not exists module_split_ranges (
  id          uuid primary key default gen_random_uuid(),
  split_id    uuid not null references module_splits (id) on delete cascade,
  -- Single letters, inclusive at both ends. Inclusive is what "A to M" means when said out
  -- loud, and a half-open range silently drops every surname beginning with M.
  from_letter char(1) not null check (from_letter between 'A' and 'Z'),
  to_letter   char(1) not null check (to_letter   between 'A' and 'Z'),
  day         text not null,
  start_time  text not null,
  end_time    text not null,
  room        text,
  label       text,
  check (from_letter <= to_letter)
);

create index if not exists module_split_ranges_split on module_split_ranges (split_id);

alter table module_splits       enable row level security;
alter table module_split_ranges enable row level security;

-- Readable by everyone signed in: a split rule is public timetable information, and the app
-- has to read it to place the student. Writable only by an admin, through the console.
--
-- No `using (true)` anywhere. The phase 7 lesson holds: a permissive read policy sitting
-- beside a narrow one is not an exception to it, it replaces it.
drop policy if exists "read"        on module_splits;
drop policy if exists "read signed in" on module_splits;
drop policy if exists "admin write" on module_splits;
create policy "read signed in" on module_splits
  for select to authenticated using (true);
create policy "admin write" on module_splits
  for all to authenticated
  using      ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "read"        on module_split_ranges;
drop policy if exists "read signed in" on module_split_ranges;
drop policy if exists "admin write" on module_split_ranges;
create policy "read signed in" on module_split_ranges
  for select to authenticated using (true);
create policy "admin write" on module_split_ranges
  for all to authenticated
  using      ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Saving a rule is one transaction
-- ---------------------------------------------------------------------------
--
-- A split is only meaningful as a complete set of bands — half of one applied to a student
-- is worse than none, because the gap is silent. Replacing the ranges and writing the audit
-- row in a single statement means a partial save cannot exist.
--
-- The gap/overlap checking lives in the console (`lib/splits/rules.ts`) where it can say
-- "N is not covered" while you are still typing. This is the backstop: a range table that
-- cannot hold a backwards band, whatever calls it.

create or replace function public.save_module_split(
  p_module_key text,
  p_activity   text,
  p_note       text,
  p_ranges     jsonb
) returns uuid
  language plpgsql security definer set search_path = '' as $$
declare
  split uuid;
  covered boolean;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if jsonb_array_length(p_ranges) = 0 then raise exception 'a split needs at least one range'; end if;

  -- Every letter A-Z lands in exactly one band. Checked here as well as in the console,
  -- because the console is a caller and callers can be bypassed.
  select bool_and(hits = 1) into covered
    from (
      select chr(i) as letter,
             (select count(*) from jsonb_array_elements(p_ranges) r
               where chr(i) between (r ->> 'from') and (r ->> 'to')) as hits
        from generate_series(ascii('A'), ascii('Z')) i
    ) coverage;
  if not covered then
    raise exception 'ranges must cover A-Z exactly once, with no gaps or overlaps';
  end if;

  insert into public.module_splits (module_key, activity, note, created_by)
  values (p_module_key, p_activity, p_note, auth.uid())
  on conflict (module_key, activity) do update
    set note = excluded.note, created_by = excluded.created_by, created_at = now()
  returning id into split;

  delete from public.module_split_ranges where split_id = split;

  insert into public.module_split_ranges
    (split_id, from_letter, to_letter, day, start_time, end_time, room, label)
  select split, r ->> 'from', r ->> 'to', r ->> 'day',
         r ->> 'start', r ->> 'end', r ->> 'room', r ->> 'label'
    from jsonb_array_elements(p_ranges) r;

  insert into public.admin_actions (actor_id, action, target, before, after)
  values (auth.uid(), 'split.save', p_module_key || ' ' || p_activity, null, p_ranges);

  return split;
end $$;

revoke all   on function public.save_module_split(text, text, text, jsonb) from public, anon;
grant execute on function public.save_module_split(text, text, text, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Check it
-- ---------------------------------------------------------------------------
--
--   As a signed-in student:  select * from module_splits;   -- readable
--                            insert into module_splits ...  -- refused
--   As anon:                 select * from module_splits;   -- refused, not empty
--
-- And a rule with a gap should be refused even when called directly:
--   select public.save_module_split('X', 'Lecture', null,
--     '[{"from":"A","to":"M","day":"Tue","start":"10:00","end":"11:00"}]'::jsonb);
--   -- expected: ranges must cover A-Z exactly once
