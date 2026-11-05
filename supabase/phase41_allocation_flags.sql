-- ---------------------------------------------------------------------------
-- Phase 41 — the console's Flags page
-- ---------------------------------------------------------------------------
--
-- Phase 13's resolve_allocation writes a row to allocation_flags when a student's name and
-- student ID disagree with the class list, and leaves them on the programme's general
-- timetable rather than guess. Until now nothing read that table, so no admin ever saw a
-- flag. These two functions are what the Flags page reads and writes.
--
-- The page shows the account's public ID (PI), never a name or the ID that was tried: the
-- same rule as People. The flag says which class list and which kind of disagreement;
-- the admin works out the rest from the list itself.
--
-- Marking a flag resolved only closes it. If the disagreement is still there, the next
-- time that student's app checks the class list writes a new one.
--
-- RUN ORDER: after phase 13. Safe to re-run. Run it in the Supabase SQL editor.

-- Open flags first, then those resolved in the last 30 days, newest first in each.
create or replace function public.allocation_flag_list()
  returns table (id bigint, course_key text, pi text, reason text,
                 created_at timestamptz, resolved_at timestamptz)
  language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;

  return query
    select f.id, f.course_key, p.pi, f.reason, f.created_at, f.resolved_at
      from public.allocation_flags f
      left join public.profiles p on p.id = f.user_id
     where f.resolved_at is null or f.resolved_at > now() - interval '30 days'
     order by (f.resolved_at is null) desc, f.created_at desc
     limit 500;
end $$;

create or replace function public.resolve_allocation_flag(p_id bigint)
  returns boolean language plpgsql security definer set search_path = '' as $$
declare
  flag record;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;

  update public.allocation_flags set resolved_at = now()
   where id = p_id and resolved_at is null
  returning course_key, reason into flag;
  if not found then return false; end if;

  -- No user ID or PI in the audit row: admin_actions is kept for good, and the flag row
  -- (which goes when the account does) already says whose it was.
  insert into public.admin_actions (actor_id, action, target, before, after)
  values (auth.uid(), 'flag.resolve', flag.course_key,
          jsonb_build_object('flag', p_id, 'reason', flag.reason), null);
  return true;
end $$;

revoke all    on function public.allocation_flag_list()          from public, anon;
revoke all    on function public.resolve_allocation_flag(bigint) from public, anon;
grant execute on function public.allocation_flag_list()          to authenticated, service_role;
grant execute on function public.resolve_allocation_flag(bigint) to authenticated, service_role;
