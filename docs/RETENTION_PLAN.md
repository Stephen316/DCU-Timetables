# Retention plan

What would bring students back to the app, in order of payoff, and what each piece needs.
The website half is being built to [RETENTION_BUILD_PLAN.md](RETENTION_BUILD_PLAN.md).

## Where things stand

Only the website (`app.dculive.ie`, usually added to the Home
Screen) is in students' hands. That limits what's possible today:

- **Class alerts** are local notifications from `expo-notifications`
  (`mobile/src/data/notifications.ts`). They work in the native and Mac builds only: the
  browser build gets `alerts: null` (`mobile/src/data/services.ts`).
- **Widgets** are SwiftUI (`mobile/targets/widgets`) and need the native app. A website
  can't have them, so they wait for a native release.
- **Web push** does work for a website once it's on the Home Screen: iOS 16.4+ for Home
  Screen web apps, and Android Chrome for any site. It needs a service worker and a
  server to send from, and neither exists yet. This is the path for notifications before
  any native release.
- **No usage data**: nothing records when someone last opened the app.

The app's best reason to come back is information people can't get elsewhere:
classmates' cancellation reports and shared deadlines. Today that only reaches people
who happen to open the app.

## 1. Measure first (website, now)

Add `profiles.last_seen_at`, updated at most once a day when the app opens. That's enough
to chart weekly active users by week of the semester and see whether anything below helps.
It adds no tracking SDK.

## 2. Close the loop for contributors (website, now)

When someone's cancellation report becomes the verdict, or their deadline is confirmed,
show it the next time they open the app: "Your report saved 31 classmates a trip." It's
the main reason anyone reports again. The counts are in `contributor_stats`, which only
admins can read today, so this needs a narrow per-user function rather than opening that
view.

## 3. Web push for the community news (website, needs a server)

The biggest win. Two kinds, each with its own switch:

- **Class status**: "Your 2pm EE lab has been reported cancelled (4 reports)", sent when
  a class's status crosses the bar or an organiser confirms it.
- **New deadline**: "New deadline on EE101: Lab report, due Fri 5pm", sent when one is
  added or confirmed on a module the student takes.

Pieces:

- A service worker with a `push` handler. The web build already has offline caching
  (`mobile/src/data/webOffline.ts`), so check how that's registered before adding a
  second worker.
- VAPID keys, with the private key held as a Supabase secret.
- A `push_subscriptions` table (user, endpoint, keys, which kinds they want, created/last
  used), with RLS limiting each user to their own rows.
- A Supabase Edge Function that sends the push, called by a database webhook or trigger
  on the verdict and deadline tables. Drop subscriptions the push service answers 404/410.
- Asking for permission: on iOS, only after the app is on the Home Screen, and only after
  a tap. Offer it where it makes sense, for example on a class with a cancellation report.
- Class alerts can come over this channel too, so web users get "starts in 15 min".

## 4. Deadline reminders (after 3)

"Due tomorrow", "due in 3 hours", and an optional evening "2 things due this week". On
the website these go through the push server from 3. In a native build they're local
through `AlertScheduler`, but they share iOS's 64-pending cap with class alerts
(`ClassAlerts.limit`), so the planner has to pick between them.

## 5. Match the college year

Usage peaks at semester start, around exam timetables and in deadline weeks. Plan a push
for each: "Your semester 2 timetable is ready", an exam timetable view if DCU's API
serves one, and one nudge to people who haven't opened the app since last semester.

## Later, with a native release

- Home-screen widgets (already built) and a lock-screen widget or Live Activity for the
  next class.
- Expo push alongside web push from the same Edge Function, keyed by platform in
  `push_subscriptions`.

## Bigger bets

- **Friends and free slots**: "when are we both free?". It brings people back and gets
  students inviting each other.

## Guardrails

- Every kind of notification gets its own switch, off by default except the one the
  student turned on. One annoying alert is enough for them to switch the app's
  notifications off in iOS Settings, and the app can't ask again.
- No streaks or badges. It's a utility, so it should earn each visit.
- Keep calendar export. It means fewer visits, but it's useful, and the pushes above are
  what bring people back anyway.
