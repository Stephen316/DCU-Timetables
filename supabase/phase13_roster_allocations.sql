-- ---------------------------------------------------------------------------
-- Phase 13 — class lists, matched on the server
-- ---------------------------------------------------------------------------
--
-- The design is docs/csv_pipeline.mmd and docs/CSV_PIPELINE.md §2. In short:
--
--   roster_members      name_key / student_id -> allocation_key.  Nobody reads it directly.
--   course_allocations  allocation_key -> group, subgroup, rooms.  No names, no IDs.
--   resolve_allocation  the caller's own key, matched on the name stored on their profile.
--
-- Until this phase the app matched a student to their lab group against a class list file
-- sitting on the phone. That is the matcher this replaces: matching now happens here and
-- nowhere else, and no device ever holds a name that is not its owner's.
--
-- Names on a class list are never stored as written. The console reduces each one to
-- `name_key` — the letters of given name then family name, lowercased, accents dropped.
--
-- Email addresses are account information and nothing else. Supabase Auth keeps them in
-- auth.users to sign people in; no table here copies one, and matching never reads one.
-- The student's name is taken from their verified address once, when the account is
-- created, and stored on their profile (given_name, family_name). That stored name is
-- what links them to their classes.
--
-- Safe to re-run. Run it in the Supabase SQL editor.

create extension if not exists pgcrypto with schema extensions;

-- Functions nobody may call directly live here. PostgREST exposes `public` only, and the
-- API roles get no usage on this schema at all.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Student ID — collected once, changed only by an admin
-- ---------------------------------------------------------------------------
--
-- A second key into the same roster, for lecturers who publish allocations by student
-- number. It is typed, not verified, so §2.1's rule applies: it is set once, because an
-- ID that could be changed freely would turn resolve_allocation into a lookup service
-- for the whole cohort — try IDs until one matches.
--
-- The app does not ask for it yet. Everything below works without it; a roster keyed by
-- name resolves from the email address alone.

alter table profiles add column if not exists student_id text;

alter table profiles drop constraint if exists profiles_student_id_format;
alter table profiles add constraint profiles_student_id_format
  check (student_id is null or student_id ~ '^[A-Z][0-9]{8}$');

-- ---------------------------------------------------------------------------
-- 1b. The student's name, stored once from the verified address
-- ---------------------------------------------------------------------------
--
-- stephen.harcourt2@mail.dcu.ie -> given "Stephen", family "Harcourt". The address was
-- verified by a one-time code, so this is the one name here nobody can type in for
-- someone else — which is why it is set by a trigger, not by the app, and only an admin
-- may change it. `display_name` stays what it was: a label the app sets, trusted for
-- nothing.

alter table profiles add column if not exists given_name  text;
alter table profiles add column if not exists family_name text;

-- The last dotted part is the family name; everything before it is given names. Digits
-- are DCU's disambiguators (stephen.harcourt2), not part of anyone's name.
create or replace function private.name_from_email(p_email text)
  returns table (given text, family text) language sql immutable set search_path = '' as $$
  with parts as (
    select array_remove(regexp_split_to_array(
             regexp_replace(lower(split_part(coalesce(p_email, ''), '@', 1)), '[^a-z.]', '', 'g'),
             '\.'), '') as p
  )
  select case when cardinality(p) >= 2 then initcap(array_to_string(p[1:cardinality(p) - 1], ' '))
              when cardinality(p) = 1 then initcap(p[1]) end,
         case when cardinality(p) >= 2 then initcap(p[cardinality(p)]) end
    from parts;
$$;

revoke all on function private.name_from_email(text) from public, anon, authenticated;

-- Runs as the profile row is created, which handle_new_user does just after the account
-- row exists — so the address is there to read, and read this once.
create or replace function private.set_profile_name() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  select n.given, n.family into new.given_name, new.family_name
    from auth.users u, private.name_from_email(u.email) n
   where u.id = new.id;
  return new;
end $$;

revoke all on function private.set_profile_name() from public, anon, authenticated;

drop trigger if exists set_profile_name on profiles;
create trigger set_profile_name
  before insert on profiles for each row execute function private.set_profile_name();

-- Accounts that already exist. The guard below lets this through because a migration has
-- no auth.uid().
update profiles p
   set given_name = n.given, family_name = n.family
  from auth.users u, private.name_from_email(u.email) n
 where u.id = p.id and p.given_name is null;

-- phase0's guard, plus: a student may fill student_id in once, never change it, and may
-- never change the name their address gave them.
create or replace function public.guard_profile_update() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if public.is_admin() then
    if old.role = 'admin' and new.role <> 'admin'
       and (select count(*) from public.profiles where role = 'admin') <= 1 then
      raise exception 'refusing to remove the last admin';
    end if;
    return new;
  end if;

  if new.role is distinct from old.role
     or new.banned_until is distinct from old.banned_until
     or new.ban_reason   is distinct from old.ban_reason
     or new.pi           is distinct from old.pi
     or new.note         is distinct from old.note then
    raise exception 'only an admin may change role, ban state, PI or note';
  end if;

  if new.given_name is distinct from old.given_name
     or new.family_name is distinct from old.family_name then
    raise exception 'your name comes from your DCU address — ask an admin to change it';
  end if;

  if old.student_id is not null and new.student_id is distinct from old.student_id then
    raise exception 'your student ID is already set — ask an admin to change it';
  end if;
  return new;
end $$;

-- Normalises before writing, so " a1234 5678 " and "A12345678" are the same ID.
create or replace function public.set_student_id(p_student_id text)
  returns text language plpgsql security definer set search_path = '' as $$
declare
  normalised text := upper(regexp_replace(coalesce(p_student_id, ''), '\s', '', 'g'));
  current_id text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if normalised !~ '^[A-Z][0-9]{8}$' then
    raise exception 'a student ID is one letter and eight digits, like A00000000';
  end if;

  select student_id into current_id from public.profiles where id = auth.uid();
  if current_id is not null then
    if current_id = normalised then return normalised; end if;
    raise exception 'your student ID is already set — ask an admin to change it';
  end if;

  update public.profiles set student_id = normalised where id = auth.uid();
  return normalised;
end $$;

-- ---------------------------------------------------------------------------
-- 2. The HMAC key
-- ---------------------------------------------------------------------------
--
-- §2.0: allocation keys are HMAC(secret, course || name_key || disambiguator), so they
-- are stable across a re-import and cannot be recomputed by anyone who lacks the secret.
-- Over a 207-name cohort a plain hash would be reversible in seconds; this one is not,
-- for exactly as long as the secret stays here.
--
-- It is generated inside the database and never leaves it: not in the repo, not in an
-- environment variable, not in the console. Vault encrypts it at rest. Rotating it is
-- private.rotate_roster_key(), which re-derives every key in one transaction.

do $$ begin
  if not exists (select 1 from vault.secrets where name = 'roster_hmac_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'roster_hmac_key',
      'HMAC key for roster allocation keys — docs/CSV_PIPELINE.md §2.0');
  end if;
end $$;

-- The course is in the input so one student's keys in two courses are unrelated, and the
-- full course_allocations table cannot be used to follow a person across courses.
-- chr(31) separates the parts so ("ab", "c") and ("a", "bc") cannot collide.
create or replace function private.allocation_key(p_course text, p_name text, p_disambig text)
  returns bytea language sql security definer set search_path = '' stable as $$
  select extensions.hmac(
    convert_to(p_course || chr(31) || coalesce(p_name, '') || chr(31) || coalesce(p_disambig, ''), 'UTF8'),
    decode((select decrypted_secret from vault.decrypted_secrets where name = 'roster_hmac_key'), 'hex'),
    'sha256');
$$;

-- Anyone able to call this could compute the key for any name and read that person's row
-- out of course_allocations. It is reachable only from the definer functions below.
revoke all on function private.allocation_key(text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Tables
-- ---------------------------------------------------------------------------

-- One per course. Readable by anyone signed in: a title, a count and a version number.
-- The app compares `version` against what it cached, and re-resolves when it moves —
-- that is the diagram's "re-import triggers re-resolve" (n36 -.-> n9).
create table if not exists rosters (
  course_key  text primary key,
  title       text,
  version     int  not null default 1,
  members     int  not null default 0,
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now()
);

-- The only table holding anything derived from a name. No policies and no grants: the
-- definer functions are the only way in, so there is no policy list to get wrong.
create table if not exists roster_members (
  course_key     text  not null references rosters (course_key) on delete cascade,
  allocation_key bytea not null,
  name_key       text,
  student_id     text,
  -- What separated this row from a same-named one when its key was derived. Kept so a key
  -- rotation reproduces exactly the keys an import would, rather than re-deciding the order.
  disambig       text  not null,
  primary key (course_key, allocation_key),
  check (name_key is not null or student_id is not null)
);

create index if not exists roster_members_name on roster_members (course_key, name_key);
create index if not exists roster_members_id   on roster_members (course_key, student_id);

-- Inert: opaque keys against groups and rooms. §2.0 allows this to be read in full —
-- cohort sizes and group structure, no names — and the course in the HMAC stops rows
-- being linked across courses.
create table if not exists course_allocations (
  course_key     text  not null references rosters (course_key) on delete cascade,
  allocation_key bytea not null,
  grp            text  not null,
  subgroup       text,
  day            text,
  workshop       text,
  drawing        text,
  primary key (course_key, allocation_key)
);

-- "Conflict: name and ID disagree" in the diagram goes to an admin rather than being
-- decided silently. Holds who and why, never the ID that was tried.
create table if not exists allocation_flags (
  id          bigint generated always as identity primary key,
  course_key  text not null,
  user_id     uuid not null references auth.users (id) on delete cascade,
  reason      text not null,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

alter table rosters            enable row level security;
alter table roster_members     enable row level security;
alter table course_allocations enable row level security;
alter table allocation_flags   enable row level security;

drop policy if exists "read signed in" on rosters;
create policy "read signed in" on rosters for select to authenticated using (true);

drop policy if exists "read signed in" on course_allocations;
create policy "read signed in" on course_allocations for select to authenticated using (true);

drop policy if exists "admin read" on allocation_flags;
create policy "admin read" on allocation_flags for select to authenticated
  using ((select public.is_admin()));

-- Writes go through save_roster only. Supabase grants every privilege on new public
-- tables to anon and authenticated by default; take them back rather than rely on the
-- absence of a write policy.
revoke all on table rosters, roster_members, course_allocations, allocation_flags
  from public, anon, authenticated;
grant select on table rosters, course_allocations, allocation_flags to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Saving a class list
-- ---------------------------------------------------------------------------
--
-- p_members: [{ name_key?, student_id?, group, subgroup?, day?, workshop?, drawing? }]
--
-- Replaces the course's roster wholesale. Keys are deterministic, so a student present
-- in both the old and new list keeps their key, and a phone that cached it stays right.
--
-- The disambiguator (§2.0 point 3): two students with the same name would otherwise get
-- the same key and be merged into one allocation. The student ID separates them when the
-- list has one; otherwise their order in the list does.
--
-- The audit row records counts. Not names — admin_actions is kept for good, and the
-- roster is not meant to be.

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
     set disambig = coalesce(i.student_id, d.n::text)
    from (select ord, row_number() over (partition by name_key order by ord) as n
            from incoming) d
   where d.ord = i.ord;
  update incoming set allocation_key = private.allocation_key(p_course_key, name_key, disambig);

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
-- 5. Resolving the caller
-- ---------------------------------------------------------------------------
--
-- Returns the caller's own allocation key, or a status saying why not. Never another
-- row, never a count, never a candidate's name.
--
--   matched    one row — allocation_key is set
--   ambiguous  several rows share the caller's name; call again with p_subgroup
--   none       not on this list
--   conflict   the name and the student ID point different ways; flagged for an admin
--   no_roster  nothing has been imported for this course
--
-- The name is the one stored on the profile at sign-up (1b), not anything the client
-- sends: it came from an address verified by a one-time code, and only an admin can
-- change it, so it is the one identifier here nobody can type in for someone else. The student ID is self-asserted, so it only ever narrows a name match,
-- or matches a row that has no name at all (§2.1's table).

create or replace function public.resolve_allocation(
  p_course_key text,
  p_subgroup   text default null
) returns table (status text, allocation_key text, version int)
  language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  roster_version int;
  given text;
  family text;
  caller_name text;
  caller_flipped text;
  caller_id text;
  candidates bytea[];
  narrowed bytea[];
  flag_reason text;
begin
  if uid is null then raise exception 'not signed in'; end if;

  select r.version into roster_version from public.rosters r where r.course_key = p_course_key;
  if not found then
    return query select 'no_roster'::text, null::text, null::int;
    return;
  end if;

  -- The name stored on the profile when the account was made — not the address, which
  -- is account information and is not read here. "Stephen" + "Harcourt" -> the key
  -- "stephenharcourt", which is what the console makes of "Harcourt, Stephen".
  --
  -- Also "harcourtstephen", family name first. A class list with one name column leaves
  -- the model to decide which part is the surname, and getting it backwards would leave a
  -- student who never matches — silently. Two different people whose names are each
  -- other's reverse would both match, which the "ambiguous" branch then handles.
  select p.given_name, p.family_name, p.student_id into given, family, caller_id
    from public.profiles p where p.id = uid;
  caller_name := regexp_replace(lower(coalesce(given, '') || coalesce(family, '')), '[^a-z]', '', 'g');
  if family is not null then
    caller_flipped := regexp_replace(lower(family || coalesce(given, '')), '[^a-z]', '', 'g');
  end if;

  if coalesce(caller_name, '') <> '' then
    select array_agg(m.allocation_key) into candidates
      from public.roster_members m
     where m.course_key = p_course_key and m.name_key in (caller_name, caller_flipped);
  end if;

  if candidates is not null then
    if caller_id is not null then
      -- Rows that carry an ID must carry this one. A name match whose ID disagrees is
      -- not a match — and not something to decide here.
      select array_agg(m.allocation_key) into narrowed
        from public.roster_members m
       where m.course_key = p_course_key
         and m.allocation_key = any (candidates)
         and (m.student_id is null or m.student_id = caller_id);
      if narrowed is null then
        flag_reason := 'name matched, student ID did not';
      end if;
      candidates := narrowed;
    end if;
  elsif caller_id is not null then
    select array_agg(m.allocation_key) into candidates
      from public.roster_members m
     where m.course_key = p_course_key and m.student_id = caller_id;
    -- A typed ID landing on a row that has a name, which is not this account's name, is
    -- someone else's row.
    if candidates is not null and exists (
         select 1 from public.roster_members m
          where m.course_key = p_course_key
            and m.allocation_key = any (candidates)
            and m.name_key is not null) then
      flag_reason := 'student ID matched a row under another name';
      candidates := null;
    end if;
  end if;

  if flag_reason is not null then
    insert into public.allocation_flags (course_key, user_id, reason)
    select p_course_key, uid, flag_reason
     where not exists (select 1 from public.allocation_flags f
                        where f.course_key = p_course_key and f.user_id = uid
                          and f.reason = flag_reason and f.resolved_at is null);
    return query select 'conflict'::text, null::text, roster_version;
    return;
  end if;

  if candidates is null or cardinality(candidates) = 0 then
    return query select 'none'::text, null::text, roster_version;
    return;
  end if;

  -- Several: the diagram asks which subgroup, and never shows the other names.
  if cardinality(candidates) > 1 and p_subgroup is not null then
    select array_agg(a.allocation_key) into candidates
      from public.course_allocations a
     where a.course_key = p_course_key
       and a.allocation_key = any (candidates)
       and a.subgroup = p_subgroup;
  end if;

  if candidates is not null and cardinality(candidates) = 1 then
    return query select 'matched'::text, encode(candidates[1], 'hex'), roster_version;
  else
    return query select 'ambiguous'::text, null::text, roster_version;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Rotating the key
-- ---------------------------------------------------------------------------
--
-- For when the secret may have leaked. Every key changes, so every phone re-resolves on
-- its next launch — the version bump is what tells them.

create or replace function private.rotate_roster_key() returns void
  language plpgsql security definer set search_path = '' as $$
begin
  perform vault.update_secret(id, encode(extensions.gen_random_bytes(32), 'hex'))
     from vault.secrets where name = 'roster_hmac_key';

  drop table if exists pg_temp.rekey;
  create temporary table rekey on commit drop as
  select m.course_key, m.allocation_key as old_key,
         private.allocation_key(m.course_key, m.name_key, m.disambig) as new_key
    from public.roster_members m;

  update public.course_allocations a set allocation_key = r.new_key
    from rekey r where a.course_key = r.course_key and a.allocation_key = r.old_key;
  update public.roster_members m set allocation_key = r.new_key
    from rekey r where m.course_key = r.course_key and m.allocation_key = r.old_key;
  update public.rosters set version = version + 1;
end $$;

revoke all on function private.rotate_roster_key() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Grants — restated for every function, as in every phase since 8
-- ---------------------------------------------------------------------------

revoke all    on function public.set_student_id(text)              from public, anon;
revoke all    on function public.save_roster(text, text, jsonb)     from public, anon;
revoke all    on function public.resolve_allocation(text, text)     from public, anon;
grant execute on function public.set_student_id(text)              to authenticated;
grant execute on function public.save_roster(text, text, jsonb)     to authenticated;
grant execute on function public.resolve_allocation(text, text)     to authenticated;
