# Contributing

Thanks for helping. DCU Timetables is a small student project, so the process is light:
open an issue first for anything bigger than a typo, so we can agree on the approach before
you spend time on it.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Contributions are
accepted under the repository's [MIT License](../LICENSE).

## Where things live

| Folder | What it is |
| --- | --- |
| `mobile/` | The iPhone app — React Native with Expo |
| `mobile/targets/widgets/` | Home-screen widgets — SwiftUI (WidgetKit can't be React Native) |
| `web/` | The admin console — Next.js |
| `supabase/` | Database schema and numbered migrations |
| `site/` | Privacy policy, terms and support pages (GitHub Pages) |
| `docs/` | Architecture, the DCU API reference, and design notes |

Read [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) before changing the data layer, and
[`docs/API.md`](../docs/API.md) before touching anything that talks to `mytimetable.dcu.ie`.

## Setting up

Node 22 or newer. The [README](../README.md#getting-started) has the full steps; the short
version for the app is:

```bash
cd mobile
npm ci
cp .env.example .env.local      # Supabase URL and anon key — optional for most UI work
npx expo start
```

`EXPO_PUBLIC_PREVIEW=1 npx expo start --web` opens the app signed in on fixture data, with
no network or account — the quickest way to check a screen.

## Before you open a pull request

Run the same checks CI runs:

```bash
scripts/ci.sh mobile   # type-check, lint, unit tests, full bundle
scripts/ci.sh web      # console production build
```

- **Keep each pull request to one change.** A fix and an unrelated refactor are two PRs.
- **Add or update tests** in `mobile/__tests__/` for any logic change.
- **Database changes** go in a new `supabase/phaseN_<name>.sql` file — never edit a
  migration that has already run. Keep row-level security on every table.
- **Native changes** (new native modules, entitlements, `app.json` permissions, widget
  Swift) need a new store build and App Review, not an over-the-air update. Say so in the
  PR description.
- **Don't change** the bundle ID or App Group, and don't edit the generated
  `mobile/ios` / `mobile/android` folders.
- **Never commit secrets.** `.env.local` and `Local.xcconfig` are git-ignored for a reason.

## Commit messages

One sentence, present tense, no trailing period, prefixed by type:

```
Feat - show the room capacity on the class detail sheet
Fix - keep the week arrows visible on small phones
Docs - explain the CSV pipeline's column mapping
```

Prefixes: `Feat`, `Fix`, `Docs`, `Refactor`, `Test`, `Chore`.

## Reporting bugs and security issues

Use the [issue templates](https://github.com/Stephen316/DCU-Timetables/issues/new/choose)
for bugs and ideas. **Security problems go through [SECURITY.md](SECURITY.md)**, not a
public issue.
