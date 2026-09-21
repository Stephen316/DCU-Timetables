-- DCU Timetable — phase 0: identity, roles, bans, audit.
--
-- RUN ORDER:  schema.sql  →  THIS FILE.
-- Safe to run more than once. Every statement either creates something missing or
-- replaces it in place.
--
-- ⚠️  Re-running schema.sql AFTER this file silently drops the ban checks in §6, because
--     it recreates those three insert policies without them. If you ever re-run
--     schema.sql, re-run this file straight after.
--
-- What this adds: the database currently knows about votes but not voters — a user id is
-- a bare text column with nothing to join to. Everything in docs/ADMIN_CONSOLE.md assumes
-- an identity with a role, so that comes first. Nothing user-visible changes.
--
-- Section 11 (the DCU-domain hook) needs a switch flipped in the dashboard afterwards.
-- Everything else takes effect the moment this runs.

-- ---------------------------------------------------------------------------
-- 1. Profiles
-- ---------------------------------------------------------------------------

do $$ begin
  create type app_role as enum ('student', 'trusted', 'admin');
exception when duplicate_object then null; end $$;

create table if not exists profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  role          app_role not null default 'student',
  pi            text unique,          -- public identifier, e.g. K482913 — see §4.2
  display_name  text,                 -- a convenience label; NOT proof of identity (below)
  programme     text,
  banned_until  timestamptz,          -- null = not banned
  ban_reason    text,
  note          text,                 -- free text for you, e.g. "Stephen — phone"
  created_at    timestamptz not null default now()
);

-- `display_name` is set by the client from the signed-in DCU address, so a determined
-- user can put anything in it. When identity actually matters (granting trust, a ban),
-- go by `pi` plus the verified address in auth.users — never by this column.

-- ---------------------------------------------------------------------------
-- 2. Public identifier
-- ---------------------------------------------------------------------------
--
-- Letter + 6 digits. I and O are excluded: read aloud or retyped they are 1 and 0, and
-- this string's whole job is to survive being sent to you in a message.
--
-- `random()` is not cryptographically strong, and that is fine here — a PI is an
-- identifier, not a credential. Knowing someone's PI grants nothing on its own; what
-- stops misuse is that you confirm who you're talking to before granting trust (§4.2).

create or replace function public.new_pi() returns text
  language sql volatile as $$
  select substr('ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + floor(random() * 24)::int, 1)
      || lpad(floor(random() * 1000000)::text, 6, '0');
$$;

create or replace function public.assign_pi(target uuid) returns text
  language plpgsql security definer set search_path = '' as $$
declare candidate text;
begin
  for _attempt in 1..50 loop
    candidate := public.new_pi();
    begin
      update public.profiles set pi = candidate where id = target and pi is null;
      if found then return candidate; end if;
      return (select pi from public.profiles where id = target);   -- already had one
    exception when unique_violation then
      -- collided with an existing PI; draw again. 24M values, so this is rare.
    end;
  end loop;
  raise exception 'could not allocate a free PI after 50 attempts';
end $$;

-- ---------------------------------------------------------------------------
-- 3. A profile for every user, automatically
-- ---------------------------------------------------------------------------
--
-- Without this a new sign-up has no profile row, and every is_banned() check below
-- passes them — a missing row is not a banned row. This trigger is the thing that keeps
-- the default safe.

create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  perform public.assign_pi(new.id);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- Backfill: existing users predate the trigger.
insert into profiles (id) select id from auth.users on conflict (id) do nothing;

do $$
declare r record;
begin
  for r in select id from public.profiles where pi is null loop
    perform public.assign_pi(r.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Role helpers
-- ---------------------------------------------------------------------------
--
-- These MUST be `security definer`. A policy on `profiles` that itself selects from
-- `profiles` recurses infinitely (Postgres 42P17) and the table becomes unreadable.
-- Running as the owner sidesteps the policy.
--
-- `set search_path = ''` is not decoration: without it, a security definer function is
-- privilege-escalatable by anyone who can create a schema on the search path. Hence
-- every reference below is fully qualified.

create or replace function public.is_banned() returns boolean
  language sql stable security definer set search_path = '' as $$
  select coalesce((select banned_until > now() from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_trusted() returns boolean
  language sql stable security definer set search_path = '' as $$
  select coalesce((select role in ('trusted','admin') from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = '' as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false)
  -- ⚠️  MFA GATE — leave this commented until you have actually enrolled TOTP on the
  --     console account. Enabling it first locks you out of your own database, and
  --     you would have to come back here as postgres to undo it.
  --
  --     and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
  ;
$$;

-- ---------------------------------------------------------------------------
-- 5. Protecting the columns that matter
-- ---------------------------------------------------------------------------
--
-- RLS grants or denies a whole row, never a column. A student must be able to set their
-- own display_name, and must not be able to set their own role — so the split has to be
-- a trigger, not a policy.
--
-- Note `is_trusted()` is deliberately absent here. Trust that can mint trust is not a
-- hierarchy, it is a free-for-all after the first mistake. Only an admin promotes.

create or replace function public.guard_profile_update() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  -- auth.uid() is null when the statement did not arrive through PostgREST — the SQL
  -- editor, a migration, or the service role. Without this carve-out §9 below cannot
  -- run: there is no admin yet, so is_admin() is false, and the guard would block the
  -- very update that creates the first admin. Chicken, meet egg.
  if auth.uid() is null then
    return new;
  end if;

  if public.is_admin() then
    -- The last admin must not be able to demote themselves; nobody is left to undo it.
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
  return new;
end $$;

drop trigger if exists guard_profile_update on profiles;
create trigger guard_profile_update
  before update on profiles for each row execute function public.guard_profile_update();

alter table profiles enable row level security;

drop policy if exists "read own"    on profiles;
drop policy if exists "update own"  on profiles;
drop policy if exists "admin write" on profiles;

-- is_admin(), not is_trusted(): a trusted account is one that may be sitting unlocked on
-- a phone, and this table carries display_name — the whole roster. Trusted users get the
-- contributor_stats view (phase 3) instead, which never selects a name.
create policy "read own"   on profiles for select using (id = auth.uid() or public.is_admin());
create policy "update own" on profiles for update
  using       (id = auth.uid() or public.is_admin())
  with check  (id = auth.uid() or public.is_admin());   -- USING alone lets the row be rewritten to another owner

-- ---------------------------------------------------------------------------
-- 6. Bans, enforced by the database
-- ---------------------------------------------------------------------------
--
-- A ban that only greys out a button in the app is not a ban: PostgREST is a plain HTTP
-- API and anyone can call it with curl. These three policies are the actual ban.

drop policy if exists "insert own" on cancellation_reports;
create policy "insert own" on cancellation_reports for insert
  with check (auth.uid()::text = reporter_id and not public.is_banned());

drop policy if exists "insert own" on module_deadlines;
create policy "insert own" on module_deadlines for insert
  with check (auth.uid()::text = submitter_id and not public.is_banned());

drop policy if exists "insert own" on deadline_confirmations;
create policy "insert own" on deadline_confirmations for insert
  with check (auth.uid()::text = confirmer_id and not public.is_banned());

-- ---------------------------------------------------------------------------
-- 7. Audit log
-- ---------------------------------------------------------------------------
--
-- When a lecture is wrongly cancelled for 400 people, "who did that and when" must be a
-- query, not an investigation. Written server-side only — no client insert policy.

create table if not exists admin_actions (
  id        bigserial primary key,
  actor_id  uuid references profiles (id) on delete set null,
  action    text not null,          -- 'user.ban', 'trust.grant', 'deadline.verify', ...
  target    text,
  before    jsonb,
  after     jsonb,
  at        timestamptz not null default now()
);

create index if not exists admin_actions_at_idx on admin_actions (at desc);

alter table admin_actions enable row level security;
drop policy if exists "admin read" on admin_actions;
create policy "admin read" on admin_actions for select using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 8. Account deletion
-- ---------------------------------------------------------------------------
--
-- App Store Guideline 5.1.1(v) requires in-app account deletion, and it is a common
-- rejection — so it ships in phase 0 rather than being discovered at submission.
--
-- The contributions survive, the link does not. A departing student taking twenty real
-- deadlines down with them is a worse outcome for everyone than a few authorless rows.
--
-- Each deleted account gets its OWN fresh random id rather than one shared tombstone:
-- both report tables have a composite primary key including the user id, so pointing two
-- deleted users at the same tombstone would collide on any class they both reported.
-- A fresh id per person also keeps the vote counts honest — one departed person still
-- counts as exactly one vote.

create or replace function public.anonymise_contributions() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare ghost text := gen_random_uuid()::text;
begin
  update public.cancellation_reports   set reporter_id  = ghost where reporter_id  = old.id::text;
  update public.module_deadlines       set submitter_id = ghost where submitter_id = old.id::text;
  update public.deadline_confirmations set confirmer_id = ghost where confirmer_id = old.id::text;
  return old;
end $$;

drop trigger if exists anonymise_contributions on profiles;
create trigger anonymise_contributions
  before delete on profiles for each row execute function public.anonymise_contributions();

-- The app cannot delete its own auth.users row with an anon key, so it calls this.
-- The profiles row cascades from auth.users, which fires the trigger above.
create or replace function public.delete_own_account() returns void
  language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from auth.users where id = auth.uid();
end $$;

revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Make yourself admin  ←  EDIT THESE TWO LINES, THEN RUN THEM
-- ---------------------------------------------------------------------------
--
-- Two accounts, deliberately unlinked (§0.1). The console account is provisioned by hand
-- in the Supabase dashboard on any address you control — it never goes through the
-- sign-up flow, so the DCU-domain rule doesn't apply to it. It never votes; it operates.
--
--   select id, email from auth.users order by created_at;    -- find the two uids
--
--   update profiles set role = 'admin',   display_name = 'Console'        where id = '<console-uid>';
--   update profiles set role = 'trusted', note         = 'Stephen — phone' where id = '<student-uid>';

-- ---------------------------------------------------------------------------
-- 10. Check it worked
-- ---------------------------------------------------------------------------
--
--   select id, role, pi, banned_until from profiles;         -- every user has a PI
--   select count(*) from auth.users;                         -- ...and the counts match
--   select count(*) from profiles;

-- ---------------------------------------------------------------------------
-- 11. DCU-domain enforcement (Before User Created hook)
-- ---------------------------------------------------------------------------
--
-- `DCUEmail` already rejects non-DCU addresses, but a client check is decoration: the Auth
-- API is public HTTP and anyone can POST to /auth/v1/signup directly. Until this hook is
-- live, "DCU students only" is a UI guard, not a boundary — exactly as docs/SIGN_IN.md says.
--
-- ⚠️  RUNNING THIS SQL IS NOT ENOUGH. The function does nothing until you switch it on:
--        Dashboard → Authentication → Hooks → "Before User Created"
--        → Postgres → public.hook_before_user_created → Enable
--     Verify it took by trying to sign up with a non-DCU address; it should be refused.

-- Addresses allowed through despite not being DCU ones. You will need at least one:
-- **App Review testers cannot get a DCU address**, and an app they can't sign into is a
-- rejection. Add the demo account here before you submit.
create table if not exists auth_domain_exceptions (
  email text primary key,
  note  text,
  added_at timestamptz not null default now()
);

-- No policies, deliberately. With RLS on and nothing granting access, no client can read or
-- write this table; the hook reaches it as its owner (security definer) instead.
alter table auth_domain_exceptions enable row level security;

create or replace function public.hook_before_user_created(event jsonb)
  returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare
  address text;
  domain  text;
begin
  address := lower(event -> 'user' ->> 'email');

  -- Exactly one '@', and the domain is what follows it. A suffix test would be the bug
  -- here: `like '%dcu.ie'` also accepts `notdcu.ie`, and `like '%.dcu.ie'` accepts
  -- `dcu.ie.attacker.com`. Capturing the whole domain and comparing it entire is the only
  -- version that can't be dressed up. Same rule as `DCUEmail`, which pins it in tests.
  domain := (regexp_match(coalesce(address, ''), '^[^@]+@([^@]+)$'))[1];

  if domain in ('dcu.ie', 'mail.dcu.ie') then
    return '{}'::jsonb;
  end if;

  if exists (select 1 from public.auth_domain_exceptions where lower(email) = address) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'message', 'Sign up with your DCU address (@dcu.ie or @mail.dcu.ie).',
      'http_code', 403
    )
  );
end $$;

-- Only the auth service may call it. Leaving it callable by `anon` would let anyone probe
-- the exception list by timing or by trying addresses against it.
grant  execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_before_user_created(jsonb) from authenticated, anon, public;

-- What this does NOT cover, so it isn't mistaken for more than it is:
--   * Existing accounts. The hook fires on sign-up only; anyone already registered stays.
--   * Changing an address later, which is a different flow. It still requires confirming
--     the new mailbox, and role and ban state live in `profiles`, not in the address — so
--     an address change grants nothing. Worth knowing, not worth blocking.
--
-- To let a non-DCU address through (an App Review demo account, a second admin):
--   insert into auth_domain_exceptions (email, note)
--   values ('reviewer@example.com', 'App Review demo — remove after 1.0 is approved');
