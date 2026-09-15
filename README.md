# DCU-Timetables

An iOS app to help DCU students keep track of all their modules, classes, and
deadlines — built on DCU's live public timetable API.

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

## Docs

- [`docs/PLAN.md`](docs/PLAN.md) — scope, milestones, risks, open decisions.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — layers and data flow.
- [`docs/API.md`](docs/API.md) — the verified DCU public-API reference.

## Status

Early scaffold: Core domain, a live API client, programme search, and a week view.
Not yet released.
