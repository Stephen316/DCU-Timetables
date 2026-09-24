# DCU-Timetables

An iPhone app to help DCU students keep track of all their modules, classes, and
deadlines — built on DCU's live public timetable API. React Native with Expo, in
[`mobile/`](mobile); the home-screen widgets are SwiftUI, in
[`mobile/targets/widgets`](mobile/targets/widgets). The admin console is in [`web/`](web).

## What it does

- **Sign in with a DCU address**, then the student number from the card's barcode.
- **Your own timetable**: Year-1 Engineering students are matched to their lab group on the
  server; anyone else searches for their programme and turns off the groups they're not in.
- **Day and week views**, clash detection, and a "next class" highlight.
- **Cancellation reports and verdicts**, shared **deadlines** with confirmations.
- **Offline** — the last copy of each week opens with no signal.
- **Home-screen widgets** for today's classes and upcoming deadlines.

## How it gets data

DCU's timetable system (`mytimetable.dcu.ie`) is a Scientia/Semestry *MyTimetable v4*
app whose backend serves the whole institution's timetable as JSON, reachable
**anonymously** (guest mode, `Authorization: Anonymous`). See [`docs/API.md`](docs/API.md)
for the verified reference. This is unofficial and undocumented, so the data layer is
deliberately swappable (see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)). Everything
shared between students goes through Supabase ([`supabase/`](supabase)).

## Getting started

Requires Node 22+.

```bash
cd mobile
npm ci
cp .env.example .env.local      # then fill in the Supabase URL and anon key
npx expo start                  # press i for the iOS simulator (macOS), or scan with a dev build
```

Expo Go runs everything except the widgets, which need the app's own native target. For
the whole thing use a **development build**: `npx expo run:ios` on a Mac, or
`eas build --profile development`.

**Preview mode** opens the app signed in, on a week of fixture classes, reports and
deadlines, with no network or account — for checking screens:

```bash
EXPO_PUBLIC_PREVIEW=1 npx expo start --web
```

## Configuration

### Supabase config

`EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` replace the old
git-ignored `supabase.local.json`. Locally they go in `mobile/.env.local` (git-ignored).
**For cloud builds they must be EAS environment variables**, or the build ships with
sign-in switched off and every report kept on the phone. Set them once per environment in
the Expo dashboard (Project → Environment variables), or for example:

```bash
cd mobile
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_URL --value https://<ref>.supabase.co --visibility plaintext
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <anon key> --visibility plaintext
```

(`EXPO_PUBLIC_` values are compiled into the app bundle, so they are public by design — the
anon key always was. Row-level security is what protects the data.)
`eas.json` maps the `development`, `preview` and `production` build profiles to the
matching EAS environments. Optional: `EXPO_PUBLIC_DCU_API_BASE` moves the DCU API host,
which is versioned and has moved before.

### Identity: bundle ID, team, versions

- **Bundle ID stays `com.stephenh.dcutimetable`** (widgets: `com.stephenh.dcutimetable.widgets`),
  so it is the same app in App Store Connect and existing records carry over. Don't change it
  in `app.json`.
- **App Group `group.com.stephenh.dcutimetable`** is on both the app and the widget; it is
  how the widgets get their data.
- **Apple Team ID** stays out of the repo, as it did in `Local.xcconfig`: set
  `APPLE_TEAM_ID` in your shell for a local `expo prebuild`/`run:ios`. EAS Build signs with
  the team from its own credentials.
- **Build numbers** are managed by EAS (`appVersionSource: remote`, `autoIncrement`). Before
  the first EAS build, set the iOS build number above the last one uploaded from Xcode:
  `eas build:version:set -p ios`.
- **Version** is `1.0` in `app.json`. The widget target's version is fixed at `1.0` by
  `@bacons/apple-targets`, so when you bump the app's version, check the widget's
  `CFBundleShortVersionString` still matches (App Store Connect warns on a mismatch).
- Minimum iOS is 17.0 (`expo-build-properties`), as before.

### Widgets

The widgets are still SwiftUI (`mobile/targets/widgets`): WidgetKit extensions can't be
written in React Native. `@bacons/apple-targets` links that folder into the Xcode project
at prebuild. The app writes a JSON snapshot of the coming week and upcoming deadlines into
the App Group's `UserDefaults` (`src/data/widgets.ts`); the widget reads it
(`WidgetSnapshotStore.swift`). Keep the two shapes in step.

### Native changes vs over-the-air updates

Anything that adds or changes a **native** module or setting — the camera barcode
scanner, the widget target, entitlements, `app.json` permissions, a new Expo package
with native code — needs a **new build and App Review**. `eas update` over-the-air
updates only cover JavaScript and images.

`mobile/ios` and `mobile/android` are generated (`npx expo prebuild`) and git-ignored — never
edit them by hand.

## CI

`scripts/ci.sh` runs exactly what GitHub Actions runs, so run it before pushing:

```bash
scripts/ci.sh          # both
scripts/ci.sh web      # console production build (type-checks every file)
scripts/ci.sh mobile   # app: type-check, lint, 278 unit tests, and a full bundle
```

On push to `main` and on pull requests, `.github/workflows/web.yml` and `mobile.yml` run
the same script, each only when its own files change.

## Docs

- [`docs/PLAN.md`](docs/PLAN.md) — scope, milestones, risks, open decisions.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — layers and data flow.
- [`docs/API.md`](docs/API.md) — the verified DCU public-API reference.

## Status

The app was converted from Swift/SwiftUI to React Native (Expo SDK 57). The Swift unit
tests were ported to Jest and pass. Not yet released from the new codebase.
