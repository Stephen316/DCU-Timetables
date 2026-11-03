# Retention build plan

## Context

`docs/RETENTION_PLAN.md` parks the plan for getting students back into the app. Only the
website (the Home Screen web app on GitHub Pages) is in students' hands, and today it can't
notify anyone: class alerts are local `expo-notifications`, and the browser build gets
`alerts: null` (`mobile/src/data/services.ts:59`). The app's best reason to come back is the
shared data (classmates' cancellation reports, verdicts and deadlines), which only reaches
people who happen to open it.

This builds the website half: a usage measure, feedback for contributors, web push for
cancellations and new deadlines, and deadline reminders. It runs on what's already free:
Supabase (pg_cron, pg_net, Edge Functions) and the existing service worker. Widgets, Expo
push and the college-year pushes stay parked.

## Step 1: last seen (one commit)

- `supabase/phase35_last_seen.sql`: `profiles.last_seen_at timestamptz`, and
  `touch_last_seen()` (security definer, `auth.uid()` only), which only writes when the
  stored value is a day or more old. Grants follow `phase29_saved_programme.sql`: revoke
  from public/anon, grant to authenticated.
- Client: call it once per launch and on return to the foreground after sign-in, through the
  existing `rpc` path in `mobile/src/data/stores.ts`, fire-and-forget. Find the sign-in →
  timetable point in `mobile/src/state/root.tsx`.
- Add a query to `docs/ADMIN_CONSOLE.md` that charts weekly active users.

## Step 2: tell contributors their report or deadline helped (one commit)

- `supabase/phase36_my_contributions.sql`: `my_recent_contributions(since timestamptz)`
  returns only the caller's own items that crossed a line since `since`:
  - a cancellation report whose class reached the bar (`CANCELLATION_THRESHOLD` 3 and net 2,
    as in `mobile/src/core/cancellation.ts`) or got a matching verdict, with the count of
    people who agreed;
  - a deadline they added, with its number of confirmations (`deadline_confirmations`).
- Client: once the timetable has loaded, ask, then show one in a card over the timetable
  (the app's `BottomCard`, as Export to Calendar uses), for example "You and 3 others
  reported Materials Engineering lab cancelled". Each is told once, remembered in prefs;
  never while the tutorial is due. Pure wording and selection in `core/contributions.ts`.
- UI change, so update `docs/TUTORIAL_TEXT.txt` and the tutorial's steps if a target moves.

## Step 3: web push for class status and new deadlines (one commit)

**Targeting.** The server doesn't know a student's classes: the timetable comes from DCU on
the phone. So each subscription stores what the phone already knows:

- `event_keys text[]`: `CancellationRules.eventKey` of every class in the loaded weeks (this
  week and next, the same set `WeekModel.scheduleAlerts` plans from). Refreshed when the
  plan changes.
- `module_keys text[]`: the student's modules, for deadlines.

Classes more than about two weeks ahead get no cancellation push until the app is opened
again. That's acceptable, and the docs will say so.

**Database** (`supabase/phase37_web_push.sql`):
- `push_subscriptions`: user, endpoint (unique), p256dh, auth, `event_keys`, `module_keys`,
  per-kind switches (`class_status`, `new_deadlines`, all off by default), created and last
  used. RLS limits each user to their own rows. GIN indexes on both arrays.
- `save_push_subscription(...)` and `delete_push_subscription(endpoint)` RPCs.
- `push_outbox(kind, ref, subscription_id, payload jsonb, created_at, sent_at, error)`,
  unique on (kind, ref, subscription_id), so nothing is sent twice.
- `queue_pushes()`, run by pg_cron every minute. It inserts outbox rows for:
  - a class whose crowd tally just reached the bar (`cancellation_tallies`), or a new or
    changed `event_verdicts` row, sent to subscriptions whose `event_keys` contain it;
  - a deadline added more than 10 minutes ago that still exists and whose author isn't
    hidden or banned, sent to subscriptions whose `module_keys` contain its module, minus
    the author. The delay lets moderation catch junk first.
  When it inserted anything, it calls the Edge Function through `pg_net`, with a key kept in
  Supabase Vault.
- Housekeeping: delete sent outbox rows after 7 days, in the same job.

**Edge Function** (`supabase/functions/send-pushes/index.ts`): checks the caller's key, reads
unsent outbox rows in batches with the service role, sends Web Push with VAPID (`npm:web-push`;
check it runs in Supabase's Deno, otherwise `jsr:@negrel/webpush`), marks them sent, and
deletes subscriptions answered with 404 or 410. Titles come from `module_titles` and
`module_abbreviations`, matching the app.

**Service worker** (`mobile/public/sw.js`): add `push` (show the notification with tag and
data) and `notificationclick` (focus or open the app at the class or deadline). The same
worker keeps the offline copy, so registration in `mobile/src/data/webOffline.ts` stays.

**Client:**
- `mobile/src/data/webPush.ts`: support check (`PushManager`, and on iOS only when
  `navigator.standalone`), permission request from a tap, `pushManager.subscribe` with
  `EXPO_PUBLIC_VAPID_PUBLIC_KEY`, save and delete through the RPCs.
- Keep `event_keys` and `module_keys` current from `WeekModel`, next to `scheduleAlerts`, by
  comparing a signature the same way.
- `mobile/src/features/alerts/NotificationsSheet.tsx`: replace the "don't work in a web
  browser" footer with: in Safari but not on the Home Screen, point to Add to Home Screen
  (the tutorial has the steps); on the Home Screen, a Turn On button and switches for
  "Class cancelled or moved" and "New deadlines". Sign-out deletes the subscription.
- Pure parts (payload shape, the targeting lists, support decisions) in `core/` with jest
  tests, following `__tests__/alerts.test.ts`.
- `.github/workflows/pages.yml`: pass `EXPO_PUBLIC_VAPID_PUBLIC_KEY` from repository
  variables.
- Update `docs/TUTORIAL_TEXT.txt`. Write `docs/PUSH.md`: the moving parts, one-time setup
  (VAPID keys, function secrets, Vault key, cron), and how to send a test push.

## Step 4: deadline reminders (one commit)

- `supabase/phase38_deadline_reminders.sql`: a `deadline_reminders` switch on
  `push_subscriptions`, and `queue_pushes()` also queues "due tomorrow" (due 3 to 24 hours
  out) and "due in 3 hours" for subscribers on the module. It skips a deadline the student
  has ticked off. Ticks live on the phone (`CompletedDeadlines`), so the phone sends their
  ids with its subscription. The student's own name for a deadline (`deadline_labels`) is
  used when they gave one.
- Client: a "Deadline reminders" switch in the sheet. Tutorial text.

## One-time setup that needs you

These are outward-facing, so I'll ask before each:

- Run the `phase35`–`phase38` SQL in the Supabase SQL editor (the repo's convention), or I
  apply them through the Supabase MCP if you say so.
- Enable the `pg_cron` and `pg_net` extensions.
- Generate VAPID keys locally. You add the private key as a function secret, and the public
  key as a repository variable and a function secret.
- Deploy the Edge Function (Supabase CLI or MCP).

## Verification

- `npx jest`, `npx tsc --noEmit` and `npx expo lint` in `mobile/`.
- `npx expo export -p web`, served locally and opened in the browser pane: the service
  worker registers, the sheet shows the right state, and Turn On creates a
  `push_subscriptions` row (check with `execute_sql`).
- Backend: insert test reports on a test account's class until it reaches the bar, run
  `select queue_pushes()`, check the outbox rows and the function's logs (`get_logs`), and
  check a desktop browser gets the notification.
- On an iPhone Home Screen install, your part: turn notifications on and confirm one
  arrives and opens the right class.
