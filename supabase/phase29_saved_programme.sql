-- ---------------------------------------------------------------------------
-- Phase 29 — the programme a student picked, kept with their account
-- ---------------------------------------------------------------------------
--
-- Signing out clears everything personal from the phone, so the next person to sign in
-- there starts clean. The student number already comes back from `profiles.student_id`
-- on the next sign-in; this does the same for the programme, so signing back in (or in
-- on a new phone) lands on the timetable instead of the programme search.
--
--   programme  DCU's timetable category, as the app picked it: {identity, name,
--              categoryTypeIdentity}. Null until one is picked.
--
-- Not personal beyond what the profile already holds: a programme code says less than
-- the class list the student may already be matched to.
--
-- Written through set_programme, which a student may change as often as they like —
-- unlike the student ID, a programme is a choice, not a fact about them.
--
-- Safe to re-run. Run it in the Supabase SQL editor.

alter table profiles add column if not exists programme jsonb;

alter table profiles drop constraint if exists profiles_programme_shape;
alter table profiles add constraint profiles_programme_shape
  check (programme is null or (
    jsonb_typeof(programme) = 'object'
    and jsonb_typeof(programme -> 'identity') = 'string'
    and jsonb_typeof(programme -> 'name') = 'string'
    and octet_length(programme::text) <= 1000
  ));

-- Keeps only the three fields the app reads, so nothing else rides along on the row.
create or replace function public.set_programme(p_programme jsonb)
  returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update public.profiles
     set programme = case when p_programme is null or jsonb_typeof(p_programme) = 'null' then null
                          else jsonb_build_object(
                                 'identity', p_programme -> 'identity',
                                 'name', p_programme -> 'name',
                                 'categoryTypeIdentity', coalesce(p_programme -> 'categoryTypeIdentity', '""'::jsonb))
                     end
   where id = auth.uid();
end $$;

revoke all    on function public.set_programme(jsonb) from public, anon;
grant execute on function public.set_programme(jsonb) to authenticated;
