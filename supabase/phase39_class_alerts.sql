-- ---------------------------------------------------------------------------
-- Phase 39 — class alerts, pushed, 15 minutes before each class
-- ---------------------------------------------------------------------------
--
-- The native app alerts 15 minutes before each class by default, scheduled on the phone. A
-- web page can't schedule one, so for the web build the server sends it, through phase 37's
-- outbox, to every browser following that class:
--
--   class_alerts   on unless the student turns it off: a student who turned notifications
--                  on before this phase gets them too.
--   event_details  what the alert says about each followed class, which the server can't
--                  work out from the event key alone: {"<event key>": {"title": "Fund. of
--                  Prof. Dev.", "room": "SA301"}}, the week grid's short name and the room
--                  as a code, as the phone works them out.
--
-- So an alert reads "Fund. of Prof. Dev." over "In 15 mins · SA301".
--
-- Not for a class called off (an organiser's verdict, or the crowd past the app's bar), as
-- the native app doesn't alert for one either. A class moved by an organiser alerts 15
-- minutes before its new time, saying so.
--
-- RUN ORDER: after phase 38. Safe to re-run. Run it in the Supabase SQL editor.

alter table push_subscriptions add column if not exists class_alerts boolean not null default true;
alter table push_subscriptions add column if not exists event_details jsonb not null default '{}';

-- Phase 38's function, with the two new settings. Both default to null, meaning "keep what
-- the row has", so a copy of the app from before this phase still saves without them.
drop function if exists public.save_push_subscription(text, text, text, text[], text[], jsonb, boolean, boolean, boolean, text[]);

create or replace function public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text,
  p_event_keys text[], p_module_keys text[], p_module_names jsonb,
  p_class_status boolean, p_new_deadlines boolean,
  p_deadline_reminders boolean default null, p_done_deadlines text[] default null,
  p_class_alerts boolean default null, p_event_details jsonb default null
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
     or octet_length(coalesce(p_module_names, '{}')::text) > 20000
     or jsonb_typeof(coalesce(p_event_details, '{}')) <> 'object'
     or octet_length(coalesce(p_event_details, '{}')::text) > 80000 then
    raise exception 'too much to follow';
  end if;

  insert into public.push_subscriptions as s
         (user_id, endpoint, p256dh, auth, event_keys, module_keys, module_names, class_status, new_deadlines,
          deadline_reminders, done_deadlines, class_alerts, event_details)
  values (me, p_endpoint, p_p256dh, p_auth, coalesce(p_event_keys, '{}'), coalesce(p_module_keys, '{}'),
          coalesce(p_module_names, '{}'), coalesce(p_class_status, false), coalesce(p_new_deadlines, false),
          coalesce(p_deadline_reminders, false), coalesce(p_done_deadlines, '{}'),
          coalesce(p_class_alerts, true), coalesce(p_event_details, '{}'))
  on conflict (endpoint) do update
     set user_id = me, p256dh = excluded.p256dh, auth = excluded.auth,
         event_keys = excluded.event_keys, module_keys = excluded.module_keys,
         module_names = excluded.module_names,
         class_status = excluded.class_status, new_deadlines = excluded.new_deadlines,
         deadline_reminders = coalesce(p_deadline_reminders, s.deadline_reminders),
         done_deadlines = coalesce(p_done_deadlines, s.done_deadlines),
         class_alerts = coalesce(p_class_alerts, s.class_alerts),
         event_details = coalesce(p_event_details, s.event_details),
         updated_at = now();

  delete from public.push_subscriptions
   where user_id = me
     and id not in (select id from public.push_subscriptions where user_id = me
                     order by updated_at desc limit 5);
end $$;

revoke all    on function public.save_push_subscription(text, text, text, text[], text[], jsonb, boolean, boolean, boolean, text[], boolean, jsonb) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text[], text[], jsonb, boolean, boolean, boolean, text[], boolean, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Queueing the alerts
-- ---------------------------------------------------------------------------
--
-- Run each minute by the job, with phase 38's reminders, before queue_pushes() wakes the Edge
-- Function. Anything starting within 15 minutes that hasn't been alerted yet: on time when
-- the job runs every minute, and still before the class if a run was missed. A class already
-- started gets nothing.

create or replace function public.queue_class_alerts()
  returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  insert into public.push_outbox (kind, ref, subscription_id, payload)
  select 'class', c.event_key || ':alert', s.id,
         jsonb_build_object('type', 'alert', 'eventKey', c.event_key, 'start', c.starts,
                            'moved', v.state = 'moved', 'room', v.room_override,
                            'title', s.event_details -> c.event_key ->> 'title',
                            'place', s.event_details -> c.event_key ->> 'room',
                            'names', s.module_names)
    from public.push_subscriptions s
    cross join lateral unnest(s.event_keys) as k(event_key)
    left join public.event_verdicts v on v.event_key = k.event_key
    cross join lateral (
      select k.event_key,
             case when v.state = 'moved' and v.start_override is not null then v.start_override
                  else public.event_key_start(k.event_key) end as starts
    ) c
   where s.class_alerts
     and c.starts > now() and c.starts <= now() + interval '15 minutes'
     and coalesce(v.state, '') <> 'cancelled'
     -- The crowd's call stands only with no verdict either way, as in the app.
     and (v.state is not null or not exists (
           select 1 from (
             select count(distinct r.reporter_id) filter (where r.stance = 'cancelled') as cancelled,
                    count(distinct r.reporter_id) filter (where r.stance = 'on')        as went_ahead
               from public.cancellation_reports r
               left join public.profiles p on p.id::text = r.reporter_id
              where r.event_key = k.event_key
                and not coalesce(p.banned_until > now(), false)) t
          where t.cancelled >= 3 and t.cancelled - t.went_ahead >= 2))
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.queue_class_alerts() from public, anon, authenticated;

-- Replaces phase 38's job of the same name.
select cron.schedule('queue-pushes', '* * * * *',
  $$select public.queue_deadline_reminders(); select public.queue_class_alerts(); select public.queue_pushes()$$);
