# DCU Timetable — public API reference (verified live 2026-09-15)

DCU's timetable system (`mytimetable.dcu.ie`, formerly `opentimetable.dcu.ie`) is a
Scientia/Semestry **MyTimetable v4** Angular SPA. Its backend serves the whole
institution's timetable as JSON, reachable **anonymously** (guest mode). No login,
no per-user token.

> **VERIFIED LIVE** 2026-09-15 — anonymous calls returned DCU institution settings, the
> 52-week calendar, ~940 programmes / ~4,955 modules / ~314 rooms, and real class events
> for the current week.

## Endpoints

```
API base:  https://scientia-eu-v4-api-d1-03.azurewebsites.net/api
Auth:      Authorization: Anonymous            # literal string — not a token
Content-Type: application/json
# Origin/Referer https://mytimetable.dcu.ie recommended

Institution identity (DCU): a1fdee6b-68eb-47b8-b2ac-a4c60c8e6177
```

| Purpose | Method | Path |
|---|---|---|
| Institution settings (confirms guest enabled) | GET | `Public/InstitutionSettings` |
| View options: weeks + days + time/date periods | GET | `Public/ViewOptions/{inst}` |
| Category type options (names → GUIDs) | GET | `Public/UserCategoryTypeOptions/{inst}` |
| Search categories (programmes/modules/rooms) | POST | `Public/CategoryTypes/{typeGuid}/Categories/FilterWithCache/{inst}` |
| **Fetch events (the timetable)** | POST | `Public/CategoryTypes/Categories/Events/Filter/{inst}` |

### Category type GUIDs

| Name | GUID | Count | pageSize |
|---|---|---|---|
| Programmes of Study | `241e4d36-60e0-49f8-b27e-99416745d98d` | ~940 | 20 |
| Module | `525fe79b-73c3-4b5c-8186-83c652b3adcc` | ~4,955 | 50 |
| Location (rooms) | `1e042cb1-547d-41d4-ae93-a1f2c3d34538` | ~314 | 200 |

## Request bodies

### Search categories — ⚠️ the term goes in the query string, not the body
`FilterWithCache` ignores a body `query` and just pages through *all* categories
alphabetically (this is why an unfiltered search returns only the A's). The search term
must be sent as URL query parameters, with an **empty JSON array** as the body:

```
POST Public/CategoryTypes/{typeGuid}/Categories/FilterWithCache/{inst}
     ?query=Computer&itemsPerPage=50&pageNumber=1&returnOccurrences=false
Body: []
```
Each result has `Identity`, `Name` (e.g. `"CASE3 (Computer Applications-3)"`),
`CategoryTypeName`, and `ParentCategoryIdentities` (module → programme/department links).
Response also has `TotalPages` / `Count`. (An empty `query=` returns the full paged list.)

### Fetch events — ⚠️ `ViewOptions` MUST be complete
Sending only `Weeks` returns HTTP 200 with **empty** `Results` — a malformed request that
looks like "no data." Include `Days`, `Weeks`, `TimePeriods`, `DatePeriods` (all from
`Public/ViewOptions/{inst}`):

```json
{
  "ViewOptions": {
    "Days":        [ {"Name":"Monday","DayOfWeek":1,"IsDefault":false}, "... all 7 ..." ],
    "Weeks":       [ {"WeekNumber":2,"WeekLabel":"2","FirstDayInWeek":"2026-09-14T00:00:00+00:00"} ],
    "TimePeriods": [ {"Description":"All Day","StartTime":"00:00","EndTime":"23:59","IsDefault":true} ],
    "DatePeriods": [ {"Description":"This Week","StartDateTime":"2026-09-14T00:00:00+00:00","EndDateTime":"2026-09-21T00:00:00+00:00","IsDefault":true,"Type":null} ]
  },
  "CategoryTypesWithIdentities": [
    { "CategoryTypeIdentity": "241e4d36-60e0-49f8-b27e-99416745d98d",
      "CategoryIdentities": ["<programme identity>"] }
  ],
  "FetchBookings": false,
  "FetchPersonalEvents": false,
  "PersonalIdentities": []
}
```
Multiple `CategoryIdentities` may be sent in one call (batch).

### Event response shape
```
CategoryEvents: [ { Identity, Name, CategoryTypeName, Results: [ <events> ] } ]
```
Each event: `StartDateTime`, `EndDateTime`, `EventType` (`"On Campus"` /
`"Synchronous"` / `"Asynchronous (Recorded)"`), `Location` (room; may list several),
`Name` (activity code with group — see below), `Description`, `WeekRanges`, `WeekLabels`,
and `ExtraProperties`: `Module Name`, `Staff Member`,
`Activity.TeachingWeekPattern_PatternAsArray`.

### Activity code (the `Name` field)
Example: `BIO1000[1]OC/L1/01 Surname A - M`
```
BIO1000   module code
[1]       occurrence / semester
OC        delivery (OC on-campus, AY asynchronous, SY synchronous …)
L1        activity kind + index  (L lecture, T tutorial, P practical/lab, S seminar)
01        group number
Surname A - M   cohort label (splits a large class into groups)
```
These identify a student's **group**, which drives group-filtering and clash detection.

## Sample (real, week of 15 Sep 2026 — programme AC1)

```
Mon 14:00–15:00  On Campus     GLA.T101           BIO1000 How life works 1 · Tejada, A   (L1, Surname A–M)
Mon 18:00–20:00  Asynchronous  —                  MTH1033 Calculus & its Applications · Nolan/Breen
Tue 11:00–12:00  On Campus     GLA.T101, GLA.HG22  PHY1027 Physics for General Science 1
Wed 09:00–12:00  On Campus     GLA.XG28 & XG28-A   CHM1008 Chemistry Laboratory (P1) · Fayne/O'Malley
```

## Caveats

- **Unofficial & undocumented.** No support, no stability guarantee.
- **Host string is versioned** (`scientia-eu-v4-api-d1-03`) and read from the SPA's
  `main.*.js` at runtime — do not hardcode long-term; re-derive it (and the institution
  id) by parsing the bundle / `InstitutionSettings`.
- **Week calendar comes from the API** (`ViewOptions`) — Wk 1 = 2026-09-07 this year — so
  no local academic-calendar anchor is needed.
- Redistributing this data in a **public** app may need DCU's OK; the officially supported
  **iCal export** is the clean-hands fallback.
