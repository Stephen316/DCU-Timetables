-- ---------------------------------------------------------------------------
-- Phase 55 — an admin can edit and delete anyone's deadline from the app
-- ---------------------------------------------------------------------------
--
-- RUN ORDER: after phase 43 (private.has_admin_role) and phase 51 (withdraw_deadline).
-- Safe to re-run. Run it in the Supabase SQL editor.
--
-- Since phase 43, public.is_admin() is true only in a browser whose console is unlocked, so
-- an admin using the app was a student there: "Edit deadline" on someone else's deadline
-- answered "not allowed", and there was no way to delete one at all. The app offered both.
--
-- Deadline moderation is now allowed in the app on the admin role alone,
-- private.has_admin_role(), which skips the console's four-digit code. That is deliberate:
-- these three functions touch shared deadlines only, never roles, bans, rosters or the
-- console itself, and every admin action is written to admin_actions as before. The console
-- keeps working unchanged (has_admin_role() is true wherever is_admin() is).
--
-- Once phase 44 is run, has_admin_role() also asks for two-step sign-in (aal2). The app
-- signs in with a password only, so these powers leave the app again then, and stay in the
-- console. Nothing here needs changing when that happens.

-- ---------------------------------------------------------------------------
-- Delete: the poster their own (as phase 51), an admin anyone's
-- ---------------------------------------------------------------------------

create or replace function public.withdraw_deadline(p_deadline uuid)
  returns void language plpgsql security definer set search_path = '' as $$
declare
  d        public.module_deadlines;
  by_admin boolean := private.has_admin_role();
begin
  if auth.uid() is null then raise exception 'not allowed'; end if;

  select * into d from public.module_deadlines where id = p_deadline for update;
  -- A student is told the same thing whether it's gone, someone else's or blocked.
  if not found then raise exception 'no such deadline of yours'; end if;
  if not by_admin and (d.submitter_id <> auth.uid()::text or d.status = 'rejected') then
    raise exception 'no such deadline of yours';
  end if;

  -- Confirmations, reports, labels and details history cascade.
  delete from public.module_deadlines where id = d.id;

  if by_admin and d.submitter_id <> auth.uid()::text then
    insert into public.admin_actions (actor_id, action, target, before, after)
    values (auth.uid(), 'deadline.remove', d.id::text,
            jsonb_build_object('module_key', d.module_key, 'title', d.title, 'kind', d.kind,
                               'due_at', d.due_at, 'status', d.status, 'submitter_id', d.submitter_id,
                               'from', 'app'),
            null);
  end if;
end $$;

revoke all on function public.withdraw_deadline(uuid) from public, anon;
grant execute on function public.withdraw_deadline(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Edit: as phase 32's edit_deadline, with the admin test on the role
-- ---------------------------------------------------------------------------

create or replace function public.edit_deadline(p_deadline uuid, p_title text, p_kind text, p_due timestamp with time zone, p_weight smallint default null)
  returns void language plpgsql security definer set search_path = '' as $$
declare
  d          public.module_deadlines;
  by_admin   boolean := private.has_admin_role();
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

revoke all on function public.edit_deadline(uuid, text, text, timestamp with time zone, smallint) from public, anon;
grant execute on function public.edit_deadline(uuid, text, text, timestamp with time zone, smallint) to authenticated;

-- ---------------------------------------------------------------------------
-- Details: as phase 32's set_deadline_details, with the admin test on the role
-- ---------------------------------------------------------------------------

create or replace function public.set_deadline_details(p_deadline uuid, p_details text)
  returns void language plpgsql security definer set search_path = '' as $$
declare
  d           public.module_deadlines;
  by_admin    boolean := private.has_admin_role();
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

-- ---------------------------------------------------------------------------
-- Check it (in a rolled-back transaction)
-- ---------------------------------------------------------------------------
--
--   begin;
--   select set_config('request.jwt.claims', '{"sub":"<an admin uid>","role":"authenticated"}', true);
--   set local role authenticated;
--   select public.edit_deadline('<someone else''s id>', 'Title', 'quiz', now() + interval '3 days', 0::smallint);
--   select public.withdraw_deadline('<someone else''s id>');      -- returns, no error
--   reset role;
--   select action from admin_actions order by id desc limit 2;   -- deadline.remove, deadline.edit
--   rollback;
--
-- As a student, withdraw_deadline on someone else's id still says "no such deadline of yours".
