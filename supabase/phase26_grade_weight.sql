-- ---------------------------------------------------------------------------
-- Phase 26 — how much of the grade a deadline is worth
-- ---------------------------------------------------------------------------
--
-- RUN ORDER: phase25_deadlines.sql → THIS FILE. Re-running phase 25 afterwards rebuilds the
-- deadlines view without this column and puts back the four-argument edit; run this file
-- again after it.
--
-- `grade_weight` is a whole percentage, 0 to 100. 0 is the default and means not graded,
-- which is also what every existing row becomes — nobody said otherwise when they posted it.
-- Whole numbers because that's how a module's breakdown is almost always written; a 7.5%
-- quiz is posted as 8 rather than blocking the form.
--
-- Changing it doesn't clear confirmations: people vouched for when it's due and what it is,
-- and a corrected weight is exactly what the poster should be able to fix freely. Disputes
-- are the check on a wrong one.
--
-- Safe to re-run. Run it in the Supabase SQL editor.

do $$ begin
  if to_regprocedure('public.set_deadline_label(uuid, text)') is null then
    raise exception 'Run phase25_deadlines.sql first.';
  end if;
end $$;

alter table module_deadlines add column if not exists grade_weight smallint not null default 0;
alter table module_deadlines drop constraint if exists module_deadlines_grade_weight_range;
alter table module_deadlines add constraint module_deadlines_grade_weight_range
  check (grade_weight between 0 and 100);

-- ---------------------------------------------------------------------------
-- Editing: phase 25's function, with the weight
-- ---------------------------------------------------------------------------
--
-- A fifth argument makes a new function rather than replacing the old one, so the old one
-- is dropped: two `edit_deadline`s would leave PostgREST choosing between them by name.

drop function if exists public.edit_deadline(uuid, text, text, timestamptz);
drop function if exists public.edit_deadline(uuid, text, text, timestamptz, smallint);

create function public.edit_deadline(p_deadline uuid, p_title text, p_kind text, p_due timestamptz,
                                      p_weight smallint default null)
  returns void language plpgsql security definer set search_path = '' as $$
declare
  d          public.module_deadlines;
  by_admin   boolean := public.is_admin();
  new_title  text := btrim(coalesce(p_title, ''));
  new_status text;
  new_weight smallint;
begin
  if auth.uid() is null or public.is_banned() then raise exception 'not allowed'; end if;

  select * into d from public.module_deadlines where id = p_deadline for update;
  if not found then raise exception 'no such deadline'; end if;
  if d.submitter_id <> auth.uid()::text and not by_admin then raise exception 'not allowed'; end if;
  if not by_admin and d.status = 'rejected' then raise exception 'this deadline was blocked'; end if;

  if char_length(new_title) = 0 or char_length(new_title) > 120 then
    raise exception 'a deadline needs a title of 1 to 120 characters';
  end if;
  if p_kind not in ('assignment', 'labReport', 'quiz', 'exam', 'presentation', 'other') then
    raise exception 'unknown kind %', p_kind;
  end if;
  -- Null keeps what's there, so a caller that doesn't know about weights can't zero one.
  new_weight := coalesce(p_weight, d.grade_weight);
  if new_weight < 0 or new_weight > 100 then raise exception 'a grade weight is 0 to 100 percent'; end if;
  -- A student can't move one into the past; an admin tidying an old row can.
  if not by_admin and p_due <= now() then raise exception 'the due date has passed'; end if;

  new_status := d.status;
  if not by_admin and d.status = 'verified' then new_status := 'pending'; end if;
  if not by_admin and public.deadline_repeats_blocked(d.id, d.module_key, new_title, p_due) then
    new_status := 'rejected';
  end if;

  if p_due <> d.due_at or p_kind <> d.kind then
    -- The poster still stands behind their own date, so their vouch survives their edit.
    delete from public.deadline_confirmations
     where deadline_id = d.id
       and (by_admin or confirmer_id <> auth.uid()::text);
    -- Disputes of the old date are answered by the new one. Only an admin resolves by name.
    update public.deadline_reports
       set resolved_at = now(), resolved_by = case when by_admin then auth.uid() end
     where deadline_id = d.id and reason = 'wrong' and resolved_at is null;
  end if;

  update public.module_deadlines
     set title = new_title, kind = p_kind, due_at = p_due, grade_weight = new_weight, edited_at = now(),
         status = new_status,
         verified_by = case when new_status = 'pending' then null else verified_by end,
         verified_at = case when new_status = 'pending' then null else verified_at end
   where id = d.id;

  if by_admin then
    insert into public.admin_actions (actor_id, action, target, before, after)
    values (auth.uid(), 'deadline.edit', d.id::text,
            jsonb_build_object('title', d.title, 'kind', d.kind, 'due_at', d.due_at, 'grade_weight', d.grade_weight),
            jsonb_build_object('title', new_title, 'kind', p_kind, 'due_at', p_due, 'grade_weight', new_weight));
  end if;
end $$;

revoke all on function public.edit_deadline(uuid, text, text, timestamptz, smallint) from public, anon;
grant execute on function public.edit_deadline(uuid, text, text, timestamptz, smallint) to authenticated;

-- ---------------------------------------------------------------------------
-- The view students read, one column wider
-- ---------------------------------------------------------------------------

drop view if exists public.module_deadlines_public;
drop function if exists private_views.module_deadlines_public();

create function private_views.module_deadlines_public()
  returns table (id uuid, module_key text, at_group_key text, title text, due_at timestamptz,
                 kind text, submitted_at timestamptz, status text, verified_by uuid, is_mine boolean,
                 edited_at timestamptz, my_label text, grade_weight smallint)
  language sql stable security definer set search_path = '' as $$
  select d.id, d.module_key, d.at_group_key, d.title, d.due_at, d.kind, d.submitted_at,
         d.status, d.verified_by,
         (d.submitter_id = auth.uid()::text),
         d.edited_at,
         (select l.label from public.deadline_labels l
           where l.user_id = auth.uid() and l.deadline_id = d.id),
         d.grade_weight
    from public.module_deadlines d
   where d.status <> 'rejected'
     and not exists (select 1 from public.hidden_authors h
                      where h.user_id = auth.uid() and h.hidden_id = d.submitter_id)
     -- Your own report hides it from you — unless it's a dispute, which is about the date,
     -- not the post.
     and not exists (select 1 from public.deadline_reports r
                      where r.deadline_id = d.id and r.reporter_id = auth.uid()
                        and r.resolved_at is null and r.reason <> 'wrong')
     and (d.status = 'verified'
          or (select count(*) from public.deadline_reports r
               where r.deadline_id = d.id and r.resolved_at is null and r.reason <> 'wrong') < 3);
$$;

revoke all on function private_views.module_deadlines_public() from public, anon;
grant execute on function private_views.module_deadlines_public() to authenticated, service_role;

create view public.module_deadlines_public with (security_invoker = on) as
  select * from private_views.module_deadlines_public();

revoke all on public.module_deadlines_public from public, anon, authenticated;
grant select on public.module_deadlines_public to authenticated;
