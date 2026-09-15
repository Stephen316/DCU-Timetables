# Engineering lab rotation

Year-1 Engineering runs EEG1001 (Workshop), EEG1004 (Drawing) and EEG1002 (Programming)
as a **group rotation** — groups A–E cycle through the labs week by week. The public
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
`ios/DCUTimetable/Resources/EngineeringLabRotation.json` — group letters × week × module.
Committed and shipped. Regenerate from the School's rotation PDF:

```
sessions[] = { week, date, day, start, end, module, groups:[letters] }
```

### 2. Surname → group (LOCAL ONLY — never committed, never shipped)
The class-allocation list contains ~100 real students' names, so it must not go into the
repo or the App Store binary. It is:

- **git-ignored** — `local-data/` and `*.local.json` (see `.gitignore`), verified not
  visible to git.
- **loaded at runtime** from the app's `Documents/eng_groups.json`, which the user imports
  themselves. If absent (any normal install), the app just offers the manual A–E picker.

Format the app expects in `Documents/eng_groups.json`:
```json
{ "bySurname": { "anand": [ { "name":"Anand Amrit","group":"B","subgroup":"B.1",
                              "day":"Tue","workshop":"SG23","drawing":"SB39" } ] } }
```

## Limitations / maintenance

- **Year-specific.** The 2026/27 rotation is hard-coded; update the JSON each academic year.
- **Bespoke to these 3 modules** and the School of Engineering's format.
- The rotation's group letters (A–E) are finer than the timetable's `P1/P2/P3`; this feature
  is the only place that finer schedule is represented.
