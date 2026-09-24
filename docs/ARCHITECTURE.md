# Architecture

The app is React Native with Expo (TypeScript), in `mobile/`. The home-screen widgets are
still SwiftUI, in `mobile/targets/widgets`, built into the same iOS app by
`@bacons/apple-targets`.

## Layers

The app is layered so the one fragile part — the unofficial DCU data source — is
isolated behind an interface and everything above it is pure and testable.

```
┌──────────────────────────────────────────────────┐
│ App        src/app (Expo Router), state/root.tsx │  routes, sign-in → timetable flow
├──────────────────────────────────────────────────┤
│ Features   src/features/*                        │  screens + view models
├──────────────────────────────────────────────────┤
│ Data       TimetableSource (interface)           │  I/O boundary
│            ├─ DCUAPIClient (+ EventMapper)        │  live JSON API
│            ├─ ProfileTimetableSource              │  modules + the lab rotation
│            ├─ Supabase stores / local fallbacks   │  reports, deadlines, verdicts…
│            └─ TimetableCache, Prefs               │  offline, on-device settings
├──────────────────────────────────────────────────┤
│ Core       src/core/*                            │  pure, no I/O, no React
└──────────────────────────────────────────────────┘
        │ widget snapshot (JSON, App Group UserDefaults)
        ▼
  targets/widgets  (SwiftUI WidgetKit extension)
```

### Core (pure) — `mobile/src/core`

No networking, no React, no storage. Every rule the iOS app had lives here, with the same
wording and the same edge cases, and is covered by the Jest suites in `mobile/__tests__`
(ported from the Swift tests).

- `timetableEvent.ts` — one class; group keys and labels; categories and the week calendar.
- `activityCode.ts` — parses `BIO1000[1]OC/L1/01 Surname A - M` into module code,
  occurrence, activity kind (`L`/`T`/`P`…), group number and cohort label.
- `cancellation.ts` — reports, tallies, verdicts, and the flagging rule (3 reports, net 2).
- `deadline.ts` — deadlines, confirmations, class highlights, the deadlines tab's buckets.
- `schedule.ts` — the day view's gaps, which day to open on, the week grid, clashes, and
  the next-class window.
- `profile.ts` — allocations, student profiles, the lab rotation, timetable changes.
- `identity.ts` — roles, the public identifier, DCU email, student number, passwords.
- `time.ts` — calendar arithmetic, and Irish time from the EU daylight-saving rule (so it
  doesn't depend on the JavaScript engine's time-zone data).

### Data (I/O boundary) — `mobile/src/data`

- `TimetableSource` — the interface the app depends on (`searchProgrammes`,
  `weekCalendar`, `events`). `DCUAPIClient` is the live implementation; every request
  carries `Authorization: Anonymous` and the **complete `ViewOptions`** (see API landmine).
- `SupabaseREST` and the stores in `stores.ts` / `courseData.ts` — PostgREST and RPC calls,
  sent as the signed-in student so row-level security can check `auth.uid()`. Without
  Supabase config each store falls back to an on-device one that is honest about being
  alone (reports never reach the threshold).
- `SupabaseSession` — the tokens, in the Keychain via `expo-secure-store`, refreshed a
  minute before expiry; a dead refresh token signs the student out and says so.
- `Prefs` — small settings in AsyncStorage, read into memory at launch so screens read
  them synchronously (what `UserDefaults`/`@AppStorage` did).
- `TimetableCache` — the last fetched copy of each week, for offline-first loading.
- `widgets.ts` — flattens what's on screen into the widget snapshot and writes it to the App
  Group with `ExtensionStorage`, then asks WidgetKit to reload.

### Features — `mobile/src/features`

Screens over small view models (`WeekModel`, `LectureModel`, `DeadlinesModel`) that hold
state and call the stores. No screen talks to the network or parses JSON directly.

## Data flow (happy path)

```
onboarding → sign in ──► student number ──► class list match (server) or pick a programme
week view  → weekCalendar() + events(for:weeks:) ──► TimetableCache (write)
             │
             └─ offline: read TimetableCache first, refresh behind it
render     → timetable changes ──► group filter ──► ClashDetector ──► day rail / week grid
           → tallies + verdicts + deadlines ──► highlights ──► widget snapshot
```

## Why an interface seam

The DCU API is unofficial: it has already migrated hosts once
(`opentimetable.dcu.ie` → `mytimetable.dcu.ie`) and its API host is a versioned string
(overridable with `EXPO_PUBLIC_DCU_API_BASE`). Keeping every screen behind
`TimetableSource` means a break is contained to one file.

## Conventions

- **Core is dependency-free and pure.** If it needs `fetch` or storage, it belongs in Data.
- **Unset values render as `--`, never `0`.**
- **Tests are Jest** (`mobile/__tests__`), with recorded JSON fixtures for the API format so
  a DCU-side change fails a test rather than shipping silently.
- `mobile/ios` and `mobile/android` are generated by `expo prebuild` and git-ignored; native
  settings live in `app.json`, `app.config.js` and `targets/widgets/expo-target.config.js`.
