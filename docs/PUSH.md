# Notifications in the web build

The Home Screen web app can't schedule a notification of its own, so the server pushes
them: when one of a student's classes is cancelled or moved, when a classmate adds a
deadline on one of their modules, before a deadline is due, and 15 minutes before each class. Everything runs on the free Supabase plan.

## How it fits together

```
phone (web build)                      Supabase                                push service
─────────────────                      ────────                                ────────────
Notifications sheet → Turn On
  Notification.requestPermission()
  pushManager.subscribe(VAPID key) ──► save_push_subscription()
WeekModel, on each change of the          push_subscriptions
  loaded weeks ─────────────────────►     (event keys, module keys,
                                           module names, kinds)
                                       pg_cron, every minute:
                                         queue_pushes() → push_outbox
                                         net.http_post ─► send-pushes ─────────► Apple / Google /
                                                          (Edge Function)        Mozilla
sw.js `push` → showNotification   ◄──────────────────────────────────────────────┘
sw.js `notificationclick` → opens the app (the Deadlines tab for a deadline)
```

- **Client**: `mobile/src/data/webPush.ts` (asking, subscribing, keeping the server's copy
  current), `mobile/src/core/webPush.ts` (the pure rules), the Notifications sheet, and the
  `push` and `notificationclick` handlers at the end of `mobile/public/sw.js`.
- **Database**: `supabase/phase37_web_push.sql`, `phase38_deadline_reminders.sql` for the
  reminders and `phase39_class_alerts.sql` for the class alerts.
- **Sender**: `supabase/functions/send-pushes/index.ts`.

What each kind sends, and to whom:

| Kind | When | To |
| --- | --- | --- |
| Cancelled, moved | An organiser's verdict | Students following that class |
| On after all | A verdict of "running" | Only those told it was off |
| Reported cancelled | The crowd reaches the app's bar (3 reports, 2 more than "it went ahead") with no verdict | Students following that class, except those who reported it |
| New deadline | 10 minutes after it's added, if it still stands | Students on the module, except its author, and only if the app would show it to them |
| Class in 15 minutes | 15 minutes before it starts, or its new time if an organiser moved it; not for one called off | Students following that class, unless they turned class alerts off (on by default) |
| Due tomorrow, due soon | Once it's due within 24 hours, and within 3 hours | Students on the module with reminders on, unless they've ticked it off (the phone sends its ticks) |

The server only knows a student's classes from what the phone sends: the classes in the
weeks it has loaded (this week and next). A class further ahead gets no push until the app
is opened and loads its week. Each push is sent once per browser (the outbox's unique key).

On iPhone, notifications only work once the app is on the Home Screen (iOS 16.4 or later).
In a Safari tab the sheet says how to add it.

## One-time setup

1. **VAPID keys.** On your Mac:

   ```bash
   npx web-push generate-vapid-keys
   ```

   Keep the private key out of the repository and out of chat.

2. **Repository variable** (GitHub → Settings → Secrets and variables → Actions →
   Variables): `EXPO_PUBLIC_VAPID_PUBLIC_KEY` = the public key. It's public by design. For a
   local build, add it to `mobile/.env.local` as well.

3. **Extensions** (Supabase → Database → Extensions): enable `pg_cron` and `pg_net`.

4. **Edge Function secrets** (Supabase → Edge Functions → Secrets):
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`: the two keys.
   - `VAPID_SUBJECT`: how a push service can reach you, as `mailto:you@example.com` or a
     URL. Defaults to the public site.
   - `PUSH_FUNCTION_KEY`: a long random string, for example from `openssl rand -hex 32`.
     Only the cron job knows it.

5. **Deploy the function**, with JWT verification off (the cron job sends
   `PUSH_FUNCTION_KEY`, not a JWT):

   ```bash
   supabase functions deploy send-pushes --no-verify-jwt --project-ref pkytnujhwjxudtrudihu
   ```

6. **Vault secrets** (SQL editor), so the cron job can find and wake the function:

   ```sql
   select vault.create_secret('https://pkytnujhwjxudtrudihu.supabase.co/functions/v1/send-pushes', 'push_function_url');
   select vault.create_secret('<the same PUSH_FUNCTION_KEY>', 'push_function_key');
   ```

7. **Run** `supabase/phase37_web_push.sql`, then `phase38_deadline_reminders.sql`, then
   `phase39_class_alerts.sql`, in the SQL editor. The first schedules the job; the others add
   reminders and class alerts to it. Deploy the function before running a phase that adds a
   kind of notification, or the old function can't word it.

## Sending a test push

Turn notifications on in the Home Screen app with a test account, then in the SQL editor:

```sql
insert into push_outbox (kind, ref, subscription_id, payload)
select 'deadline', 'test-' || now(), id,
       jsonb_build_object('type', 'deadline', 'id', gen_random_uuid(), 'moduleKey', 'TEST',
                          'title', 'Test notification', 'dueAt', now() + interval '1 day',
                          'kind', 'assignment', 'names', '{}'::jsonb)
  from push_subscriptions
 where user_id = (select id from auth.users where email = '<test account>');
```

The next run of the job sends it within a minute. Then check:

```sql
select kind, ref, sent_at, attempts, error from push_outbox order by id desc limit 5;
select status_code, content from net._http_response order by created desc limit 5;
```

The function's own log is under Supabase → Edge Functions → send-pushes → Logs.

## When a push is refused

`push_outbox.error` keeps the push service's own status and reason. The one to expect:

- **`400 {"reason":"VapidPkHashMismatch"}`** (Apple): the phone subscribed with a different
  public key from the one the function signs with. The three copies of the public key
  (`EXPO_PUBLIC_VAPID_PUBLIC_KEY` in GitHub, `VAPID_PUBLIC_KEY` in the function's secrets,
  and `mobile/.env.local`) must be one key, and `VAPID_PRIVATE_KEY` its other half. To see
  which key the function has, and whether its private key matches:

  ```sql
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'push_function_url') || '?check',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select btrim(decrypted_secret) from vault.decrypted_secrets where name = 'push_function_key')));
  -- then, a moment later:
  select content from net._http_response order by created desc limit 1;
  ```

  It answers with the first and last 8 characters of the public key, and `pairMatches`.
  Once the keys agree and the site is rebuilt, open Notifications on the phone: a
  subscription made with the old key is dropped, from the phone and from
  `push_subscriptions`, and Turn On makes a new one.

  A row left behind by an older build of the site, which dropped the phone's copy but not
  the server's, is cleared by the function itself: when a run has one push accepted and
  another refused with `VapidPkHashMismatch`, the refused subscription is deleted. A run
  where nothing is accepted deletes nothing, since then the fault may be the function's
  own key, and deleting would take every student's subscription with it.

## Turning it off

```sql
select cron.unschedule('queue-pushes');
```

Nothing more is queued or sent; subscriptions stay, so scheduling the job again picks up
where it left off.
