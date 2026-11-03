-- ---------------------------------------------------------------------------
-- Phase 38 — deadline reminders, pushed
-- ---------------------------------------------------------------------------
--
-- Two reminders for each deadline on a student's modules, through phase 37's outbox:
--
--   day   once it's due within 24 hours ("Lab report is due tomorrow at 17:00")
--   soon  once it's due within 3 hours  ("Lab report is due at 17:00")
--
-- Only to browsers with the new `deadline_reminders` switch on, and never for one the
-- student has ticked off: those ticks live on the phone, so it sends their ids with the
-- rest (`done_deadlines`). A deadline is reminded about only as the app would show it to
-- that student, by the same rules as phase 37's new-deadline push, under the student's own
-- name for it when they gave it one (deadline_labels).
--
-- RUN ORDER: after phase 37. Safe to re-run. Run it in the Supabase SQL editor.

alter table push_subscriptions add column if not exists deadline_reminders boolean not null default false;
alter table push_subscriptions add column if not exists done_deadlines text[] not null default '{}';

-- Phase 37's function, with the two new settings. Both default to null, meaning "keep what
-- the row has", so a copy of the app from before this phase still saves without them.
drop function if exists public.save_push_subscription(text, text, text, text[], text[], jsonb, boolean, boolean);

create or replace function public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text,
  p_event_keys text[], p_module_keys text[], p_module_names jsonb,
  p_class_status boolean, p_new_deadlines boolean,
  p_deadline_reminders boolean default null, p_done_deadlines text[] default null
) returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in'; end if;
  if public.is_banned() then raise exception 'not allowed'; end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) > 1000 then
    raise exception 'that is not a push endpoint';
  end if;
  if p_p256dh is null or length(p_p256dh) > 200 or p_auth is null or length(p_auth) > 100 then
    raise exception 'those are not push keys';
  end if;
  if coalesce(cardinality(p_event_keys), 0) > 300 or coalesce(cardinality(p_module_keys), 0) > 60
     or coalesce(cardinality(p_done_deadlines), 0) > 300
     or exists (select 1 from unnest(coalesce(p_event_keys, '{}') || coalesce(p_module_keys, '{}')
                                     || coalesce(p_done_deadlines, '{}')) k where length(k) > 200)
     or jsonb_typeof(coalesce(p_module_names, '{}')) <> 'object'
     or octet_length(coalesce(p_module_names, '{}')::text) > 20000 then
    raise exception 'too much to follow';
  end if;

  insert into public.push_subscriptions as s
         (user_id, endpoint, p256dh, auth, event_keys, module_keys, module_names, class_status, new_deadlines,
          deadline_reminders, done_deadlines)
  values (me, p_endpoint, p_p256dh, p_auth, coalesce(p_event_keys, '{}'), coalesce(p_module_keys, '{}'),
          coalesce(p_module_names, '{}'), coalesce(p_class_status, false), coalesce(p_new_deadlines, false),
          coalesce(p_deadline_reminders, false), coalesce(p_done_deadlines, '{}'))
  on conflict (endpoint) do update
     set user_id = me, p256dh = excluded.p256dh, auth = excluded.auth,
         event_keys = excluded.event_keys, module_keys = excluded.module_keys,
         module_names = excluded.module_names,
         class_status = excluded.class_status, new_deadlines = excluded.new_deadlines,
         deadline_reminders = coalesce(p_deadline_reminders, s.deadline_reminders),
         done_deadlines = coalesce(p_done_deadlines, s.done_deadlines),
         updated_at = now();

  delete from public.push_subscriptions
   where user_id = me
     and id not in (select id from public.push_subscriptions where user_id = me
                     order by updated_at desc limit 5);
end $$;

revoke all    on function public.save_push_subscription(text, text, text, text[], text[], jsonb, boolean, boolean, boolean, text[]) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text[], text[], jsonb, boolean, boolean, boolean, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Queueing the reminders
-- ---------------------------------------------------------------------------
--
-- Its own function, run by the same job just before queue_pushes(), which then wakes the
-- Edge Function for whatever either queued.

create or replace function public.queue_deadline_reminders()
  returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  insert into public.push_outbox (kind, ref, subscription_id, payload)
  select 'deadline', d.id::text || ':' || w.which, s.id,
         jsonb_build_object('type', 'reminder', 'when', w.which, 'id', d.id, 'moduleKey', d.module_key,
                            'title', coalesce(l.label, d.title), 'dueAt', d.due_at, 'kind', d.kind,
                            'names', s.module_names)
    from public.module_deadlines d
    cross join lateral (select case when d.due_at <= now() + interval '3 hours' then 'soon' else 'day' end as which) w
    join public.push_subscriptions s
      on s.deadline_reminders and s.module_keys @> array[d.module_key]
     and not (d.id::text = any (s.done_deadlines))
    left join public.deadline_labels l on l.user_id = s.user_id and l.deadline_id = d.id
    left join public.profiles author on author.id::text = d.submitter_id
   where d.due_at between now() and now() + interval '24 hours'
     -- The same 10 minutes' standing as a new-deadline push, for the same reason.
     and d.submitted_at < now() - interval '10 minutes'
     and d.status <> 'rejected'
     and not coalesce(author.banned_until > now(), false)
     and not exists (select 1 from public.hidden_authors h
                      where h.user_id = s.user_id and h.hidden_id = d.submitter_id)
     and not exists (select 1 from public.deadline_reports r
                      where r.deadline_id = d.id and r.reporter_id = s.user_id
                        and r.resolved_at is null and r.reason not in ('wrong', 'details'))
     and (d.status = 'verified'
          or (select count(*) from public.deadline_reports r
               where r.deadline_id = d.id and r.resolved_at is null
                 and r.reason not in ('wrong', 'details')) < 3)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.queue_deadline_reminders() from public, anon, authenticated;

-- Replaces phase 37's job of the same name.
select cron.schedule('queue-pushes', '* * * * *', $$select public.queue_deadline_reminders(); select public.queue_pushes()$$);
