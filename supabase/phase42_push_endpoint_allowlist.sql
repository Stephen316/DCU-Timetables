-- ---------------------------------------------------------------------------
-- Phase 42 — push endpoints must belong to a real push service
-- ---------------------------------------------------------------------------
--
-- save_push_subscription accepted any https:// URL as a subscription's endpoint, and the
-- send-pushes Edge Function then POSTs to whatever is stored. A signed-in student could
-- save a URL of their own and make the function send requests to it (revealing where the
-- function runs from, and aiming traffic at any public https host).
--
-- A browser's endpoint always names its vendor's push service, so the host is checked:
--
--   fcm.googleapis.com                 Chrome, Edge, Brave, Opera, Android
--   updates.push.services.mozilla.com  Firefox
--   web.push.apple.com                 Safari, and Home Screen web apps on iOS
--   *.notify.windows.com               Windows (WNS)
--
-- The host must be followed by a "/", so a trick like https://fcm.googleapis.com@evil.test/
-- (where the host is really evil.test) does not pass. The Edge Function checks the same
-- list again before it sends, for any row that predates this phase.
--
-- Rows already stored with some other host are removed: no browser produced them.
--
-- RUN ORDER: after phase 39. Safe to re-run. Run it in the Supabase SQL editor.

create schema if not exists private;

create or replace function private.is_push_service_endpoint(p_endpoint text)
  returns boolean
  language sql immutable set search_path = '' as $$
  select coalesce(
    p_endpoint ~* '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|([a-z0-9-]+\.)+notify\.windows\.com)/[^[:space:]]*$',
    false
  );
$$;

revoke all on function private.is_push_service_endpoint(text) from public, anon, authenticated;

-- Same function as phase 39, with the endpoint test tightened. Same signature, so its
-- grants carry over.
create or replace function public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text,
  p_event_keys text[], p_module_keys text[], p_module_names jsonb,
  p_class_status boolean, p_new_deadlines boolean,
  p_deadline_reminders boolean default null, p_done_deadlines text[] default null,
  p_class_alerts boolean default null, p_event_details jsonb default null
) returns void
  language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in'; end if;
  if public.is_banned() then raise exception 'not allowed'; end if;
  if p_endpoint is null or length(p_endpoint) > 1000 or not private.is_push_service_endpoint(p_endpoint) then
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

  -- An endpoint already on file is handed to whoever presents it. That is deliberate: the
  -- URL is a secret only the browser that subscribed holds (the table is read-own, and the
  -- URL goes nowhere else), so presenting it proves it is that browser — which is also how
  -- a second student signing in on a shared device takes the subscription over from the
  -- first.
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

-- Whatever predates the check. Their outbox rows go with them (on delete cascade).
delete from public.push_subscriptions
 where not private.is_push_service_endpoint(endpoint);
