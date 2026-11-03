-- ---------------------------------------------------------------------------
-- Phase 33 — a deadline's details are at most 100 characters
-- ---------------------------------------------------------------------------
--
-- RUN ORDER: phase32_deadline_details.sql → THIS FILE. Phase 32 allowed 2000; a line or two
-- is what the box is for, and a short box is a smaller target for vandalism. 100 matches
-- DETAILS_LIMIT in the app. Re-running phase 32 puts the limit back to 2000, so run this
-- file again after it.
--
-- Anything already longer is cut to 100, and the full text is kept in
-- `deadline_details_history` first, like any other replaced version, so an admin still has
-- it. Older versions in the history are left as they were: restoring one longer than 100
-- from the console is refused.
--
-- Safe to re-run. Run it in the Supabase SQL editor.

do $$ begin
  if not exists (select 1 from information_schema.tables
                  where table_schema = 'public' and table_name = 'deadline_details_history') then
    raise exception 'Run phase32_deadline_details.sql first.';
  end if;
end $$;

-- What's too long goes into the history whole, then is cut down. Recorded as replaced by no
-- one: no student made this edit.
insert into deadline_details_history (deadline_id, details, written_by, written_at, replaced_by)
select id, details, details_edited_by, details_edited_at, null
  from module_deadlines
 where char_length(details) > 100;

update module_deadlines
   set details = rtrim(left(details, 100)), details_edited_at = now()
 where char_length(details) > 100;

alter table module_deadlines drop constraint if exists module_deadlines_details_length;
alter table module_deadlines add constraint module_deadlines_details_length
  check (char_length(details) <= 100);

-- Phase 32's function with the new limit; everything else is unchanged.
create or replace function public.set_deadline_details(p_deadline uuid, p_details text)
  returns void language plpgsql security definer set search_path = '' as $$
declare
  d           public.module_deadlines;
  by_admin    boolean := public.is_admin();
  new_details text := btrim(coalesce(p_details, ''));
begin
  if auth.uid() is null or public.is_banned() then raise exception 'not allowed'; end if;
  if char_length(new_details) > 100 then raise exception 'details can be at most 100 characters'; end if;

  select * into d from public.module_deadlines where id = p_deadline for update;
  if not found then raise exception 'no such deadline'; end if;
  if not by_admin and d.status = 'rejected' then raise exception 'this deadline was blocked'; end if;

  -- Saving what's already there is no edit, and leaves no history.
  if new_details = d.details then return; end if;

  insert into public.deadline_details_history (deadline_id, details, written_by, written_at, replaced_by)
  values (d.id, d.details, d.details_edited_by, d.details_edited_at, auth.uid());

  update public.module_deadlines
     set details = new_details, details_edited_at = now(), details_edited_by = auth.uid()
   where id = d.id;

  if by_admin then
    insert into public.admin_actions (actor_id, action, target, before, after)
    values (auth.uid(), 'deadline.details', d.id::text,
            jsonb_build_object('details', d.details), jsonb_build_object('details', new_details));
  end if;
end $$;

revoke all on function public.set_deadline_details(uuid, text) from public, anon;
grant execute on function public.set_deadline_details(uuid, text) to authenticated;
