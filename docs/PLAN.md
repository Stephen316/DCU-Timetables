# DCU-Timetables — plan

## Vision

A fast, no-login iOS app that shows a DCU student their real timetable and warns them
about clashes, working offline. Not a calendar clone — it understands DCU's structure
(programmes, modules, lab/tutorial groups) so a student sees exactly the classes they
attend.

## Decisions locked

| Decision | Choice |
|---|---|
| Platform | iOS native, SwiftUI, iOS 17+ |
| Data source | DCU public timetable JSON API (anonymous guest mode) |
| Audience | Public — any DCU student |
| MVP features | Day & week views · clash detection · offline cache |

## MVP scope

1. **Onboarding** — search Programmes of Study, pick yours, then pick *your* lab/tutorial
   group(s) from the activity codes. This filter is what makes the rest correct.
2. **Week view** (primary) and **Day / today** view.
3. **Clash detection** — overlapping events on the same day, after group filtering.
4. **Offline** — cache the parsed timetable on device; open from cache; refresh in
   background; show "updated N ago" (DCU timetables change and don't auto-update, so
   surfacing staleness is a feature).

Explicitly out of MVP: room/building maps, deadlines/assignments, notifications,
widgets, personal (logged-in) timetables, Android. All are natural follow-ups.

## Architecture (summary)

Layered so the fragile data source is isolated. See `ARCHITECTURE.md` for detail.

```
Core     pure domain — models, ActivityCode parsing, clash detection, week calendar
Data     TimetableSource protocol + DCU API client (Codable) + on-disk cache
Features SwiftUI screens: onboarding (programme + group), week/day views
App      entry point, root shell
```

`TimetableSource` is a protocol; the DCU API client is one implementation. An iCal
importer (DCU's officially-supported export) is the planned fallback behind the same
protocol, so the UI never changes if the scrape source breaks.

## The data source (verified live 2026-09-15)

Full reference in `API.md`. Key points that shaped the design:

- Anonymous JSON API at `scientia-eu-v4-api-d1-03.azurewebsites.net/api`, header
  `Authorization: Anonymous`. DCU institution id `a1fdee6b-68eb-47b8-b2ac-a4c60c8e6177`.
- Three category types: **Programmes of Study**, **Module**, **Location** (rooms).
- Events carry start/end, room(s), event type (On Campus / Synchronous / Asynchronous),
  the **activity code** (`BIO1000[1]OC/L1/01 Surname A - M` → module, occurrence,
  activity kind, group, cohort), module name, and staff.
- The **week↔date calendar comes from the API** (`ViewOptions`) — no local academic
  calendar to maintain.

### Landmine (pinned by a test)

The events endpoint returns **empty `Results` unless `ViewOptions` is complete** —
`Days`, `Weeks`, `TimePeriods`, **and** `DatePeriods`. Sending only `Weeks` yields
200 OK with zero events, indistinguishable from "no classes." The API client always
sends the full shape; `EventMapperTests` guards it.

## Milestones

| Phase | Goal | Status |
|---|---|---|
| 0 — Data spike | Confirm the public API is live & anonymous; document it | ✅ done (`API.md`) |
| 1 — Core + client | Domain model, ActivityCode parsing, API client, mapper, tests | in progress |
| 2 — Offline | On-disk cache, refresh coordinator, staleness indicator | next |
| 3 — UI + filtering | Onboarding (programme → my groups), week + day views | next |
| 4 — Clash + ship | Clash flags, empty/error states, TestFlight | later |

## Risks & mitigations

1. **Unofficial API changes / is blocked.** → `TimetableSource` abstraction; recorded
   JSON fixtures pin the format; iCal fallback; (recommended) thin backend proxy.
2. **Versioned host string** (`...-v4-api-d1-03...`) read from the SPA bundle can change.
   → don't hardcode long-term; re-derive from the bundle / `InstitutionSettings`, ideally
   server-side.
3. **Programme timetable is a superset** of all streams → false clashes without the
   group-filter step. → group selection is core onboarding, not polish.
4. **Redistributing DCU data in a public app** may need DCU's OK. → keep the iCal
   (officially-exported) path available; check acceptable-use before App Store launch.

## Open decision

**Thin backend proxy vs. direct-from-app.** Recommended: a small serverless normaliser
that re-derives the host + institution id and serves clean JSON, so the app ships once
and parser fixes don't need App Store releases. Not required to start; the app currently
talks to the API directly behind `TimetableSource`, so adding a backend later is a
one-implementation swap.
