-- DCU Timetable — phase 2: deadline verification, contributor stats, audited actions.
--
-- RUN ORDER:  schema.sql → phase0_identity.sql → phase1_verdicts.sql → THIS FILE.
-- Safe to run more than once.
--
-- Everything an admin can *do* goes through an RPC here rather than a direct table write,
-- for one reason: the audit row and the action must land in the same transaction. A
-- client that writes the row and then logs it will, eventually, do the first and not the
-- second — and the case where that happens is exactly the case you needed the log for.

-- ---------------------------------------------------------------------------
-- 1. Deadline verification
-- ---------------------------------------------------------------------------

alter table module_deadlines add column if not exists status text not null default 'pending'
  check (status in ('pending', 'verified', 'rejected'));
alter table module_deadlines add column if not exists verified_by uuid references profiles (id);
alter table module_deadlines add column if not exists verified_at timestamptz;
alter table module_deadlines add column if not exists source text not null default 'student'
  check (source in ('student', 'admin', 'import', 'loop'));

create index if not exists module_deadlines_status_idx on module_deadlines (status);

-- A rejected deadline is kept, not deleted, so the same wrong date submitted again can be
-- recognised instead of quietly reappearing.
create or replace function public.verify_deadline(deadline uuid, new_status text)
  returns void
  language plpgsql security definer set search_path = '' as $$
declare previous text;
begin
  if not public.is_trusted() or public.is_banned() then
    raise exception 'not allowed';
  end if;
  if new_status not in ('pending', 'verified', 'rejected') then
    raise exception 'unknown status %', new_status;
  end if;

  select status into previous from public.module_deadlines where id = deadline;
  if not found then raise exception 'no such deadline'; end if;

  update public.module_deadlines
     set status = new_status,
         verified_by = case when new_status = 'pending' then null else auth.uid() end,
         verified_at = case when new_status = 'pending' then null else now() end
   where id = deadline;

  insert into public.admin_actions (actor_id, action, target, before, after)
  values (auth.uid(), 'deadline.' || new_status, deadline::text,
          jsonb_build_object('status', previous),
          jsonb_build_object('status', new_status));
end $$;

-- ---------------------------------------------------------------------------
-- 2. Contributor stats
-- ---------------------------------------------------------------------------
--
-- `security_invoker = off` on purpose: RLS cannot restrict columns, so wherever some
-- callers may see an aggregate but not the rows behind it, the boundary has to be a view.
-- This one reads the locked tables as its owner and exposes only counts.
--
-- Note what is absent: `display_name`. A name is admin-only (§4), and this view is the
-- thing every other screen builds on.

drop view if exists contributor_stats;
create view contributor_stats
  with (security_invoker = off) as
  select p.id, p.pi, p.role, p.programme, p.created_at, p.banned_until, p.ban_reason,
         (select count(*) from cancellation_reports   r where r.reporter_id  = p.id::text) as reports,
         (select count(*) from module_deadlines       d where d.submitter_id = p.id::text) as deadlines,
         (select count(*) from deadline_confirmations c where c.confirmer_id = p.id::text) as confirmations,
         -- The column that actually matters for moderation. Raw volume flags your most
         -- useful contributors just as loudly as your worst.
         (select count(*) from module_deadlines d
           where d.submitter_id = p.id::text and d.status = 'rejected')                    as rejected
  from profiles p;

revoke all on contributor_stats from anon, authenticated;
grant select on contributor_stats to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Trust and bans, audited
-- ---------------------------------------------------------------------------

create or replace function public.set_user_role(target uuid, new_role text)
  returns void
  language plpgsql security definer set search_path = '' as $$
declare previous public.app_role;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if new_role not in ('student', 'trusted', 'admin') then
    raise exception 'unknown role %', new_role;
  end if;

  select role into previous from public.profiles where id = target;
  if not found then raise exception 'no such user'; end if;

  -- Same guard as the trigger, restated because an RPC could otherwise walk around it.
  if previous = 'admin' and new_role <> 'admin'
     and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'refusing to remove the last admin';
  end if;

  update public.profiles set role = new_role::public.app_role where id = target;

  insert into public.admin_actions (actor_id, action, target, before, after)
  values (auth.uid(), 'user.role', target::text,
          jsonb_build_object('role', previous), jsonb_build_object('role', new_role));
end $$;

-- `until` null lifts a ban. Their reports stop counting the moment this lands, because the
-- tallies exclude banned reporters — no rows are deleted, so an unban is complete.
create or replace function public.set_user_ban(target uuid, until timestamptz, reason text)
  returns void
  language plpgsql security definer set search_path = '' as $$
declare previous timestamptz;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;

  select banned_until into previous from public.profiles where id = target;
  if not found then raise exception 'no such user'; end if;
  if target = auth.uid() then raise exception 'refusing to ban yourself'; end if;

  update public.profiles
     set banned_until = until, ban_reason = case when until is null then null else reason end
   where id = target;

  insert into public.admin_actions (actor_id, action, target, before, after)
  values (auth.uid(), case when until is null then 'user.unban' else 'user.ban' end, target::text,
          jsonb_build_object('banned_until', previous),
          jsonb_build_object('banned_until', until, 'reason', reason));
end $$;

-- Granting trust by the identifier the student hands you, rather than by searching names.
-- Returns the profile so the console can show who it is before you commit to it.
create or replace function public.find_by_pi(identifier text)
  returns table (id uuid, pi text, role public.app_role, programme text,
                 created_at timestamptz, banned_until timestamptz)
  language sql stable security definer set search_path = '' as $$
  select p.id, p.pi, p.role, p.programme, p.created_at, p.banned_until
    from public.profiles p
   where public.is_admin() and upper(p.pi) = upper(trim(identifier));
$$;

revoke all on function public.verify_deadline(uuid, text) from anon;
revoke all on function public.set_user_role(uuid, text)   from anon;
revoke all on function public.set_user_ban(uuid, timestamptz, text) from anon;
revoke all on function public.find_by_pi(text) from anon;
