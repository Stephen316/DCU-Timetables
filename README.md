# DCU-Timetables

An iOS app and a React/Tauri desktop app for Windows and macOS to help DCU students
keep track of their modules, classes, and deadlines — built on DCU's live public timetable API.

## What it does (MVP)

- **Search your programme** and pull your real timetable — no DCU login required.
- **Week & day views** of your classes.
- **Filter to *your* group** (lab/tutorial stream) so what you see is what you attend.
- **Clash detection** — flags overlapping classes once you've picked your groups.
- **Offline** — your timetable is cached and opens instantly with no signal, with a
  "last updated" indicator.

## How it gets data

DCU's timetable system (`mytimetable.dcu.ie`) is a Scientia/Semestry *MyTimetable v4*
app whose backend serves the whole institution's timetable as JSON, reachable
**anonymously** (guest mode, `Authorization: Anonymous` — no per-user login). See
[`docs/API.md`](docs/API.md) for the full, verified reference. This is unofficial and
undocumented, so the data layer is deliberately swappable (see
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)).

## Getting started

### Desktop (Windows / macOS)

The student desktop app is in [`desktop/`](desktop/README.md). It is separate from the
Next.js admin console in `web/` and does not replace the SwiftUI iOS app. Configure a
public Supabase URL and anon key, then run `npm ci && npm run tauri dev` from `desktop/`.
See its README for prerequisites, builds and limitations.

### iOS

Requires Xcode 16+ and [XcodeGen](https://github.com/yonaskolb/XcodeGen).

```bash
brew install xcodegen                        # once
cp Local.xcconfig.example Local.xcconfig     # once — set your Apple Team ID inside
xcodegen generate                            # regenerate the .xcodeproj (it is gitignored)
open DCUTimetable.xcodeproj
```

**Signing:** `Signing.xcconfig` is committed and optionally includes `Local.xcconfig`
(git-ignored), which holds your personal `DEVELOPMENT_TEAM`. Putting it there means the
team survives `xcodegen generate` — setting it in Xcode's UI does not, because the
`.xcodeproj` is regenerated. Simulator builds work without a team; a device build needs one.

Build & test from the command line:

```bash
xcodegen generate
xcodebuild -project DCUTimetable.xcodeproj -scheme DCUTimetable \
  -destination 'platform=iOS Simulator,name=iPhone 17' test
```

The `.xcodeproj` is generated from `project.yml` and **gitignored** — never hand-edit
or commit it. After adding/removing/moving a source file, re-run `xcodegen generate`.

## CI

`scripts/ci.sh` runs exactly what GitHub Actions runs, so run it before pushing:

```bash
scripts/ci.sh          # both
scripts/ci.sh web      # console production build (type-checks every file)
scripts/ci.sh ios      # xcodegen + simulator build and unit tests
```

On push to `main` and on pull requests, `.github/workflows/web.yml` and `ios.yml` run
the same script, each only when its own files change. The iOS job uses the Xcode that
`project.yml`'s `xcodeVersion` names, so bumping it there moves CI too. A failed iOS run
attaches the full `xcodebuild` log to the run.

## Docs

- [`docs/PLAN.md`](docs/PLAN.md) — scope, milestones, risks, open decisions.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — layers and data flow.
- [`docs/API.md`](docs/API.md) — the verified DCU public-API reference.

## Status

Early scaffold: Core domain, a live API client, programme search, and a week view.
Not yet released.
