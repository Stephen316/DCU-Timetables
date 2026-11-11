# Add to Google Calendar

Export to Calendar (the ⋯ menu) gives a student the rest of the year as an `.ics` file. That
works with Apple Calendar and Outlook, but **Google Calendar can't open an `.ics` on a phone**:
its Android app won't import one, and its website only imports from the desktop layout. So the
web build can also sign in with Google and add the classes itself.

## How it works

```
Export to Calendar card opens
  GoogleCalendar.prepare()      loads accounts.google.com/gsi/client, makes a token client
Tap "Add to Google Calendar"
  GoogleCalendar.signIn()       Google's window: pick an account, allow the one scope
  GoogleCalendar.add()          POST /calendars (first time only) → "DCU Live"
                                POST /calendars/{id}/events/import, 4 at a time
```

- **Scope**: `https://www.googleapis.com/auth/calendar.app.created` only. The app can make
  calendars and manage events on the calendars it made, and can't see anything else.
- **No server.** The browser talks to Google directly. The token lives in memory for the
  import and is never saved. Only the new calendar's ID is kept, under the
  `pref:googleCalendar` key, so adding again fills the same calendar.
- **No duplicates.** Each class is imported under the same `iCalUID` as the `.ics` file's
  `UID` (`<event id>@dcu-timetable`), so a second export updates the classes in place. A class
  dropped from the timetable stays in Google, the same as with the file.
- **Alerts** are the student's own (Notifications settings), as popup reminders. "None" is no
  reminders, not Google's default.
- **Where it shows**: the web build in a browser, once `EXPO_PUBLIC_GOOGLE_CLIENT_ID` is set.
  It doesn't show in the Mac app, which has Calendar, or in the native app. On Android it is the
  first button and the file is second ("Download Calendar File"). Everywhere else the file
  comes first.
- **Code**: `mobile/src/core/googleCalendar.ts` (the event format and retry rules, tested in
  `__tests__/googleCalendar.test.ts`), `mobile/src/data/googleCalendar.ts` (sign-in and API
  calls), and `mobile/src/features/week/ExportCalendarCard.tsx`. Both routes are built from
  `CalendarExport.entries`, so they word each class the same way.

## One-time setup

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project (or use
   an existing one), then go to **APIs & Services → Library** and enable the **Google Calendar API**.
2. **OAuth consent screen** (Google Auth Platform → Branding): app name *DCU Live*, your
   email as support and developer contact, home page `https://dculive.ie/`,
   privacy policy `https://dculive.ie/privacy`, terms
   `https://dculive.ie/terms`, and authorised domain
   `dculive.ie`. Audience: **External**.
3. **Data access**: add the scope `https://www.googleapis.com/auth/calendar.app.created`.
4. **Clients → Create client → Web application.** Authorised JavaScript origins:
   - `https://app.dculive.ie`
   - `https://stephen316.github.io` (the old address, until it is retired)
   - `http://localhost:8081` (the Expo dev server)

   No redirect URIs are needed, because the sign-in uses a pop-up. Copy the **Client ID**. It's
   public by design, so it isn't a secret.
5. In Vercel, open the **dcu-timetables-mobile** project → **Settings → Environment Variables**
   and add `EXPO_PUBLIC_GOOGLE_CLIENT_ID` with the client ID, for Production and Preview. Then
   redeploy (Deployments → the latest → ⋯ → Redeploy): it's built into the app, so it only
   takes effect in a new build. The old GitHub Pages build reads the same name from the
   repository's **Settings → Secrets and variables → Actions → Variables**.
6. For local work, add the same line to `mobile/.env.local`.

## Before Google verifies the app

While the app is in **Testing** in Google's console, only the test users listed there can
sign in, up to 100. Once it's switched to **In production**, anyone can sign in. Until Google
verifies the app, they see a "Google hasn't verified this app" screen and have to click
**Advanced → Go to DCU Live**, and there's a cap of 100 users in total.

To remove the warning and the cap, submit for verification from the console. Google asks
for the privacy policy, which already has a Google Calendar section with the Limited Use
statement, proof that you own the domain, and a short video of the flow. This usually takes a
few weeks.

## Testing it

- On a computer, in Chrome: ⋯ → Export to Calendar → Add to Google Calendar, then pick an account.
  The card counts the classes up and offers to open Google Calendar.
- On Android, in Chrome and from the Home Screen: the same, with Google as the first button.
- On an iPhone, in Safari and from the Home Screen. Google's pop-up in a Home Screen app is
  the most likely place for trouble. If it fails there, the card says the browser blocked the
  window.
- Export again: the class count in Google stays the same instead of doubling.
