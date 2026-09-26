# Engineering lab rotation

Year-1 Engineering runs EEG1001 Project & Technical Drawing (two columns: **Workshop** and
**Drawing**), EEG1004 Introduction to Electronics (**Lab**, SG15 & SG16) and EEG1002
Programming (**Lab**, S210/S143/S144/SG15) as a **group rotation** — groups cycle through
them week by week, and the two labs alternate fortnightly (EEG1004 in odd weeks 3–11,
EEG1002 in even weeks 2–12). The public
timetable API only shows generic lab slots (`P1/P2/P3`) and does **not** expose which
group is where in which week. That detail lives only in the School's published schedule,
so the app carries it as bundled data.

## What the feature does

- Menu → **Engineering labs** (shown only when the student's timetable contains
  EEG1001/EEG1002/EEG1004).
- Opens on the group the student's profile was matched to; they can pick another letter.
- Shows their personal lab schedule for the semester: module, day/date, time, per week.

## Profile-first onboarding

On first launch the app shows a **profile creator** (`ProfileCreatorView`). The student
picks their course from the class lists an admin has uploaded, and the server matches their
verified DCU address against that list (`resolve_allocation`). If it finds them, a
`StudentProfile` (name from the address + lab group + rooms) is created. Two students with
the same name are asked which subgroup they're in, and never shown each other's names. That
profile drives a personal **Year-1 Engineering timetable** with no programme picking:

- `ProfileTimetableSource` fetches the shared module set (`EngineeringYear1.json` →
  EEG1000/1001/1002/1004/1006/1007/1017) via the Module API and combines them.
- It **drops the generic lab slots** for the rotation modules and **injects the student's
  own rotation sessions** (from `EngineeringLabRotation.json`, filtered to their group),
  in the correct rooms.
- Anyone not in the class list can tap **"Choose a programme instead"** to fall back to the
  normal programme search.
- When an admin uploads a corrected list, its version moves, and the app resolves the
  profile again at its next launch (`AllocationRefresh`).

**Timezone note:** the rotation PDF's times are Irish local clock times, so rotation
events are built in `Europe/Dublin` (the API's own events are true UTC and converted for
display). Getting these mixed up shifts labs by an hour — see `ProfileTimetableSource`.

## Data — two files, two very different privacy levels

### 1. Rotation (bundled, no personal data)
`mobile/assets/data/EngineeringLabRotation.json` — group letters × week × module ×
activity. Committed and shipped. Regenerate from the School's rotation PDF:

```
sessions[] = { week, date, day, start, end, module, activity, groups:[letters] }
```

`activity` is the column heading the cell sits under — `Workshop`, `Drawing` or `Lab` — and
belongs to the **session**, not the module, because EEG1001 has two. Session ids are
`module-activity-date-start`: EEG1001 holds a Workshop and a Drawing at the same hour on the
same afternoon, so without the activity the rotation has 47 distinct ids for 67 sessions.

⚠️ **35 of the 67 sessions carried the wrong module until 23 Sep 2026.** The model stored one
activity per module, which cannot represent EEG1001's two columns, so the data was bent to
fit: every Drawing session was filed under EEG1004, the SG15 & SG16 lab under EEG1002, and
group E's Wednesday workshops under EEG1002. Introduction to Electronics had no lab at all.
The app labelled those sessions with the wrong module and showed group E no room for its
workshops — rooms are chosen from the activity.

It was described as hand-verified, and every validator passed it. It was found by the
extraction harness: Mistral's OCR read the PDF's header correctly and disagreed with the
file, and the file lost when both were checked against the rendered pages by eye.
`BundledLabRotationTests` now pins which module owns which column, so a future hand edit
that shifts a column fails a test rather than reaching a phone.

**Group E.** The 2026/27 PDF prints a group E (in `ABE`, `BE` and the Wednesday workshops),
but the cohort is four groups of ~52 — there are no E students. The file keeps E because it
is a transcription of the PDF, and the extraction harness has to be able to compare against
it; for A–D students `ABE` simply means A and B attend.

### 2. Class list → group (on the server only — never on a phone, never in the repo)
The class-allocation list holds real students' names with their group, subgroup, day and
rooms. The source file stays git-ignored in `local-data/`. It reaches the app only through
the console: **Ask → pick the programme → attach the list in any format (PDF, photo,
.xlsx, .docx, CSV) → check the panel → Accept**. The console turns it into CSV — directly
if it is already a headed table, through Mistral if not — and saves each name reduced to a
key. Email addresses are account information only — Supabase Auth keeps them to sign
people in. When an account is created, the student's name is taken from their address once
and stored on their profile (`given_name`, `family_name`); that stored name is what is
matched against the class list, and only an admin can change it. Phones download only opaque keys
against groups and rooms. See `CSV_PIPELINE.md` §2 and
`supabase/phase13_roster_allocations.sql`.

⚠️ **History.** Until 22 Sep 2026 every build shipped the whole roster: a bundled
`Resources/eng_groups.local.json`, git-ignored but swept into the target by XcodeGen. Until
23 Sep 2026 the app could still import the list onto the phone (`EngGroupDirectory`) and
match surnames locally. Both are gone. There is no code on the device that reads a class
list, so a list cannot reach a phone by being dropped into the project.

## Limitations / maintenance

- **Year-specific.** The 2026/27 rotation is hard-coded; update the JSON each academic year.
- **The manual picker offers group E**, because it lists every letter the rotation uses.
  No student is in E this year; picking it shows a schedule that belongs to nobody.
- **Bespoke to these 3 modules** and the School of Engineering's format.
- The rotation's group letters (A–E) are finer than the timetable's `P1/P2/P3`; this feature
  is the only place that finer schedule is represented.
