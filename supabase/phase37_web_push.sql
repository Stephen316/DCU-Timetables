-- ---------------------------------------------------------------------------
-- Phase 37 — web push for class news and new deadlines
-- ---------------------------------------------------------------------------
--
-- The Home Screen web app can't schedule a notification of its own, so until now a
-- cancellation or a new deadline only reached students who happened to open the app. This
-- sends them a push instead. The moving parts, and the one-time setup, are in
-- docs/PUSH.md:
--
--   push_subscriptions  one row per browser that turned notifications on: where to send
--                       (the push service's endpoint and keys), what the student follows,
--                       and which kinds they want.
--   push_outbox         one row per notification to send, unique per (kind, ref,
--                       subscription), so nothing is ever sent twice.
--   queue_pushes()      run every minute by pg_cron: fills the outbox, then calls the
--                       send-pushes Edge Function, which sends and marks each row.
--
-- The server doesn't know a student's classes: the timetable comes from DCU, to the phone.
-- So the phone sends what it already knows, each time its loaded weeks change:
--
--   event_keys    CancellationRules.eventKey of each class in the weeks it has loaded
--                 (this week and next). A class further ahead gets no push until the app
--                 is opened again and loads its week.
--   module_keys   the student's modules, for deadlines.
--   module_names  what the app calls each module, so a push names it the same way.
--
-- Nothing personal beyond that leaves the phone, and no one reads another student's row:
-- every write goes through the RPCs below, as the signed-in student.
--
-- RUN ORDER: after phase 36. Enable pg_cron and pg_net first (Database → Extensions), then
-- add the two Vault secrets in docs/PUSH.md. Safe to re-run. Run it in the Supabase SQL
-- editor.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- Subscriptions
-- ---------------------------------------------------------------------------

create table if not exists push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles (id) on delete cascade,
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  event_keys    text[] not null default '{}',
  module_keys   text[] not null default '{}',
  module_names  jsonb not null default '{}',
  -- Off until the student turns them on: the app sends true for the kinds they chose.
  class_status  boolean not null default false,
  new_deadlines boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx   on push_subscriptions (user_id);
create index if not exists push_subscriptions_events_idx  on push_subscriptions using gin (event_keys);
create index if not exists push_subscriptions_modules_idx on push_subscriptions using gin (module_keys);

alter table push_subscriptions enable row level security;

-- Readable as yourself, so the app could show what it last sent. Never writable directly:
-- the RPCs check every field.
drop policy if exists "read own" on push_subscriptions;
create policy "read own" on push_subscriptions
  for select using (user_id = (select auth.uid()));

revoke all on table push_subscriptions from public, anon, authenticated;
grant select on table push_subscriptions to authenticated;

/**
 * Saves this browser's subscription, or updates it: the same endpoint is the same browser.
 * A browser that changes hands (one student signs out, another signs in and turns
 * notifications on) moves to the new account. At most 5 browsers per account: a sixth
 * replaces the one updated longest ago.
 */
create or replace function public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text,
  p_event_keys text[], p_module_keys text[], p_module_names jsonb,
  p_class_status boolean, p_new_deadlines boolean
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
     or exists (select 1 from unnest(coalesce(p_event_keys, '{}') || coalesce(p_module_keys, '{}')) k where length(k) > 200)
     or jsonb_typeof(coalesce(p_module_names, '{}')) <> 'object'
     or octet_length(coalesce(p_module_names, '{}')::text) > 20000 then
    raise exception 'too much to follow';
  end if;

  insert into public.push_subscriptions as s
         (user_id, endpoint, p256dh, auth, event_keys, module_keys, module_names, class_status, new_deadlines)
  values (me, p_endpoint, p_p256dh, p_auth, coalesce(p_event_keys, '{}'), coalesce(p_module_keys, '{}'),
          coalesce(p_module_names, '{}'), coalesce(p_class_status, false), coalesce(p_new_deadlines, false))
  on conflict (endpoint) do update
     set user_id = me, p256dh = excluded.p256dh, auth = excluded.auth,
         event_keys = excluded.event_keys, module_keys = excluded.module_keys,
         module_names = excluded.module_names,
         class_status = excluded.class_status, new_deadlines = excluded.new_deadlines,
         updated_at = now();

  delete from public.push_subscriptions
   where user_id = me
     and id not in (select id from public.push_subscriptions where user_id = me
                     order by updated_at desc limit 5);
end $$;

create or replace function public.delete_push_subscription(p_endpoint text)
  returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
end $$;

revoke all    on function public.save_push_subscription(text, text, text, text[], text[], jsonb, boolean, boolean) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text[], text[], jsonb, boolean, boolean) to authenticated;
revoke all    on function public.delete_push_subscription(text) from public, anon;
grant execute on function public.delete_push_subscription(text) to authenticated;

-- ---------------------------------------------------------------------------
-- The outbox
-- ---------------------------------------------------------------------------

create table if not exists push_outbox (
  id              bigint generated always as identity primary key,
  -- 'class' or 'deadline'. `ref` says which: "<event_key>:<what happened>", a deadline id.
  kind            text not null,
  ref             text not null,
  subscription_id uuid not null references push_subscriptions (id) on delete cascade,
  -- What the Edge Function words the notification from. See send-pushes/index.ts.
  payload         jsonb not null,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,
  -- Set when a run of the Edge Function takes the row, so two runs never send it twice.
  claimed_at      timestamptz,
  attempts        smallint not null default 0,
  error           text,
  unique (kind, ref, subscription_id)
);

create index if not exists push_outbox_unsent_idx on push_outbox (id) where sent_at is null;

-- The service role only: what was sent to whom is no student's to read.
alter table push_outbox enable row level security;
revoke all on table push_outbox from public, anon, authenticated;

alter table push_outbox add column if not exists claimed_at timestamptz;

/**
 * Takes up to `p_limit` rows to send, with where to send each. A row stays taken for five
 * minutes, so a run that dies leaves it for a later one; `attempts` counts the takings, so
 * one that keeps failing stops after three.
 */
create or replace function public.claim_pushes(p_limit integer)
  returns table (id bigint, payload jsonb, subscription_id uuid, endpoint text, p256dh text, auth text)
  language sql security definer set search_path = '' as $$
  with taken as (
    update public.push_outbox o
       set claimed_at = now(), attempts = o.attempts + 1
     where o.id in (select q.id from public.push_outbox q
                     where q.sent_at is null and q.attempts < 3
                       and (q.claimed_at is null or q.claimed_at < now() - interval '5 minutes')
                     order by q.id
                     limit p_limit
                       for update skip locked)
    returning o.id, o.payload, o.subscription_id
  )
  select t.id, t.payload, t.subscription_id, s.endpoint, s.p256dh, s.auth
    from taken t join public.push_subscriptions s on s.id = t.subscription_id;
$$;

revoke all    on function public.claim_pushes(integer) from public, anon, authenticated;
grant execute on function public.claim_pushes(integer) to service_role;

-- Reports are only ever looked at for classes still to come, so by when they were made.
create index if not exists cancellation_reports_reported_at_idx on cancellation_reports (reported_at);

/** When a class starts, from its event key (`<activity>|<ISO start>`). Null if it doesn't read. */
create or replace function public.event_key_start(p_key text)
  returns timestamptz language plpgsql stable set search_path = '' as $$
begin
  return substring(p_key from '\|([^|]+)$')::timestamptz;
exception when others then
  return null;
end $$;

revoke all on function public.event_key_start(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Filling the outbox
-- ---------------------------------------------------------------------------
--
-- Each kind is one insert, and the outbox's unique key makes a repeat run a no-op, so the
-- job needs no memory of its own. Only classes still to come, in the next 15 days: a push
-- about a class that's over is noise.

create or replace function public.queue_pushes()
  returns integer language plpgsql security definer set search_path = '' as $$
declare
  queued integer := 0;
  n      integer;
  fn_url text;
  fn_key text;
begin
  -- 1. An organiser's verdict: cancelled or moved. Above the crowd, as in the app.
  insert into public.push_outbox (kind, ref, subscription_id, payload)
  select 'class', v.event_key || ':' || v.state, s.id,
         jsonb_build_object('type', 'verdict', 'eventKey', v.event_key, 'state', v.state,
                            'room', v.room_override, 'start', v.start_override, 'note', v.note,
                            'by', v.decided_by_label, 'names', s.module_names)
    from public.event_verdicts v
    join public.push_subscriptions s on s.class_status and s.event_keys @> array[v.event_key]
   where v.state in ('cancelled', 'moved')
     and public.event_key_start(v.event_key) between now() and now() + interval '15 days'
  on conflict do nothing;
  get diagnostics n = row_count; queued := queued + n;

  -- 2. "It's on after all": a verdict of running, only to those told it was off.
  insert into public.push_outbox (kind, ref, subscription_id, payload)
  select 'class', v.event_key || ':running', s.id,
         jsonb_build_object('type', 'verdict', 'eventKey', v.event_key, 'state', 'running',
                            'note', v.note, 'by', v.decided_by_label, 'names', s.module_names)
    from public.event_verdicts v
    join public.push_subscriptions s on s.class_status and s.event_keys @> array[v.event_key]
   where v.state = 'running'
     and public.event_key_start(v.event_key) between now() and now() + interval '15 days'
     and exists (select 1 from public.push_outbox o
                  where o.subscription_id = s.id and o.kind = 'class'
                    and o.ref in (v.event_key || ':cancelled', v.event_key || ':crowd'))
  on conflict do nothing;
  get diagnostics n = row_count; queued := queued + n;

  -- 3. The crowd calling it off, with no verdict either way: the app's bar of 3 reports
  --    and 2 more than "it went ahead" (CancellationRules), banned accounts not counted.
  --    Not to those who reported it themselves: they know.
  insert into public.push_outbox (kind, ref, subscription_id, payload)
  select 'class', t.event_key || ':crowd', s.id,
         jsonb_build_object('type', 'crowd', 'eventKey', t.event_key, 'count', t.cancelled,
                            'names', s.module_names)
    from (select r.event_key,
                 count(distinct r.reporter_id) filter (where r.stance = 'cancelled') as cancelled,
                 count(distinct r.reporter_id) filter (where r.stance = 'on')        as went_ahead
            from public.cancellation_reports r
            left join public.profiles p on p.id::text = r.reporter_id
           where r.reported_at > now() - interval '15 days'
             and not coalesce(p.banned_until > now(), false)
           group by r.event_key) t
    join public.push_subscriptions s on s.class_status and s.event_keys @> array[t.event_key]
   where t.cancelled >= 3 and t.cancelled - t.went_ahead >= 2
     and public.event_key_start(t.event_key) between now() and now() + interval '15 days'
     and not exists (select 1 from public.event_verdicts v where v.event_key = t.event_key)
     and not exists (select 1 from public.cancellation_reports r
                      where r.event_key = t.event_key and r.reporter_id = s.user_id::text)
  on conflict do nothing;
  get diagnostics n = row_count; queued := queued + n;

  -- 4. A new deadline, once it has stood for 10 minutes: long enough for its author to
  --    fix a typo and for a junk one to be reported or rejected first. Shown only as the
  --    app would show it to that student (module_deadlines_public's rules), never to its
  --    author, and only while it's still to come.
  insert into public.push_outbox (kind, ref, subscription_id, payload)
  select 'deadline', d.id::text, s.id,
         jsonb_build_object('type', 'deadline', 'id', d.id, 'moduleKey', d.module_key,
                            'title', d.title, 'dueAt', d.due_at, 'kind', d.kind,
                            'names', s.module_names)
    from public.module_deadlines d
    join public.push_subscriptions s
      on s.new_deadlines and s.module_keys @> array[d.module_key] and s.user_id::text <> d.submitter_id
    left join public.profiles author on author.id::text = d.submitter_id
   where d.submitted_at between now() - interval '2 days' and now() - interval '10 minutes'
     and d.due_at > now()
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
  get diagnostics n = row_count; queued := queued + n;

  -- Sent rows are kept three weeks: long enough for "it's on after all" (step 2) to find
  -- the cancellation it corrects, for any class the app could have followed.
  delete from public.push_outbox where created_at < now() - interval '21 days';

  -- Anything left to send, new or retried: wake the Edge Function. The request goes when
  -- this transaction commits. Without the Vault secrets (docs/PUSH.md) the outbox fills and
  -- waits, rather than the whole run failing and taking the queued rows with it.
  -- Trimmed: a value pasted from Terminal can carry its line break into Vault.
  select btrim(decrypted_secret, E' \n\r\t') into fn_url from vault.decrypted_secrets where name = 'push_function_url';
  select btrim(decrypted_secret, E' \n\r\t') into fn_key from vault.decrypted_secrets where name = 'push_function_key';
  if fn_url is not null and fn_key is not null
     and exists (select 1 from public.push_outbox
                  where sent_at is null and attempts < 3
                    and (claimed_at is null or claimed_at < now() - interval '5 minutes')) then
    perform net.http_post(
      url := fn_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || fn_key),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000);
  end if;
  return queued;
end $$;

revoke all on function public.queue_pushes() from public, anon, authenticated;

-- Every minute. Scheduling by the same name again replaces the job, so a re-run is safe.
select cron.schedule('queue-pushes', '* * * * *', $$select public.queue_pushes()$$);

-- ---------------------------------------------------------------------------
-- Check it
-- ---------------------------------------------------------------------------
--
--   select count(*), count(*) filter (where class_status), count(*) filter (where new_deadlines)
--     from push_subscriptions;
--   select kind, ref, created_at, sent_at, attempts, error from push_outbox order by id desc limit 20;
--   select * from cron.job_run_details where command like '%queue_pushes%' order by start_time desc limit 5;
