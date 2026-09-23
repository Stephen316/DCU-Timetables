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
- Student picks their **group letter (A–E)**, or types their **surname** to auto-detect it.
- Shows their personal lab schedule for the semester: module, day/date, time, per week.

## Profile-first onboarding

On first launch the app shows a **profile creator** (`ProfileCreatorView`): the student
types their name, it's matched against the imported class list, and — if found — a
`StudentProfile` (name + lab group + rooms) is created. That profile drives a personal
**Year-1 Engineering timetable** with no programme picking:

- `ProfileTimetableSource` fetches the shared module set (`EngineeringYear1.json` →
  EEG1000/1001/1002/1004/1006/1007/1017) via the Module API and combines them.
- It **drops the generic lab slots** for the rotation modules and **injects the student's
  own rotation sessions** (from `EngineeringLabRotation.json`, filtered to their group),
  in the correct rooms.
- Anyone not in the class list can tap **"Choose a programme instead"** to fall back to the
  normal programme search.

**Timezone note:** the rotation PDF's times are Irish local clock times, so rotation
events are built in `Europe/Dublin` (the API's own events are true UTC and converted for
display). Getting these mixed up shifts labs by an hour — see `ProfileTimetableSource`.

## Data — two files, two very different privacy levels

### 1. Rotation (bundled, no personal data)
`ios/DCUTimetable/Resources/EngineeringLabRotation.json` — group letters × week × module ×
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

### 2. Surname → group (LOCAL ONLY — never committed, never shipped)
The class-allocation list holds 207 real students' names with their group, subgroup, day
and rooms, so it must not go into the repo or the App Store binary. It is:

- **git-ignored** — `local-data/` and `*.local.json` (see `.gitignore`), verified not
  visible to git in any commit.
- **loaded at runtime** from the app's `Documents/eng_groups.json`, which the user imports
  themselves. If absent (any normal install), the app offers the manual A–E picker.

⚠️ **This was not true until 22 Sep 2026.** `EngGroupDirectory` had a second source — a
bundled `Resources/eng_groups.local.json`, git-ignored but swept into the target by
XcodeGen, so every build shipped the whole roster. It carried a comment saying to delete it
before release; a comment is not a mechanism, and it survived for months.

The file is gone and so is the code that looked for it. `fileURL()` now reads Documents or
returns nil, which makes a bundled roster impossible rather than discouraged — putting the
file back into `Resources/` has no effect, because nothing reads from there.

The 207 rows describe only 16 distinct allocations (`subgroup` determines day, workshop and
drawing), so the manual picker loses almost nothing: one tap instead of a name lookup. See
`CSV_PIPELINE.md` for the server-side replacement.

Format the app expects in `Documents/eng_groups.json`:
```json
{ "bySurname": { "anand": [ { "name":"Anand Amrit","group":"B","subgroup":"B.1",
                              "day":"Tue","workshop":"SG23","drawing":"SB39" } ] } }
```

## Limitations / maintenance

- **Year-specific.** The 2026/27 rotation is hard-coded; update the JSON each academic year.
- **The manual picker offers group E**, because it lists every letter the rotation uses.
  No student is in E this year; picking it shows a schedule that belongs to nobody.
- **Bespoke to these 3 modules** and the School of Engineering's format.
- The rotation's group letters (A–E) are finer than the timetable's `P1/P2/P3`; this feature
  is the only place that finer schedule is represented.
