# The lecture page

Tapping a class — in the day list or the week calendar — pushes a page holding everything
known about it. Three kinds of information share the screen and are kept visually distinct,
because they carry very different weight:

| Source | What it covers | Where it lives |
| --- | --- | --- |
| The university | time, date, room, delivery, module, activity code, weeks, staff | DCU's timetable API |
| Other students | cancellation reports, deadlines | Supabase, shared |
| This student | "I won't attend this" | `UserDefaults`, device-only |

## Deadlines

A deadline belongs to the **module**, not to one occurrence: an assignment set in Monday's
lecture is the same assignment seen from Thursday's lab, so `DeadlineRules.moduleKey`
buckets by module code (falling back to the raw activity code when there isn't one).

- Anyone taking the module can add one: a title, a type, and a due date.
- The list is soonest-first and **hides anything already past** — a board of last term's
  deadlines is noise.
- A student can delete their own (swipe), identified by the same anonymous id the
  cancellation reports use. Nobody is named anywhere.

## "I won't attend this"

Deliberately **never uploaded**. Unlike a cancellation this is a private choice about one
person's day, and syncing it would turn the app into an attendance record. It's a set of
event keys in one `@AppStorage` blob, so every view updates the moment it changes.

## Lecturer photos

DCU publishes staff photos on individual school and research-centre pages, **not** through
one directory or API, so no photo URL can be derived from a name. The page shows initials in
a coloured circle by default, which is honest rather than a broken image.

A photo appears for any member of staff listed in an optional bundled
`ios/DCUTimetable/Resources/lecturers.json`:

```json
[
  { "name": "Harcourt, Stephen", "photo": "https://www.dcu.ie/…/photo.jpg", "role": "Assistant Professor" }
]
```

Names are matched on their parts regardless of order, so `Harcourt, Stephen` and
`Stephen Harcourt` find the same person. The file is optional — without it nothing breaks.

## Supabase setup for deadlines (one-off)

Run this in the SQL editor, alongside the `cancellation_reports` table from
[CANCELLATION_REPORTS.md](CANCELLATION_REPORTS.md):

```sql
create table module_deadlines (
  id            uuid primary key,
  module_key    text not null,
  at_group_key  text,            -- the class it's due at; null = the whole module
  title        text not null,
  due_at       timestamptz not null,
  kind         text not null default 'assignment',
  submitter_id text not null,
  submitted_at timestamptz not null default now()
);

create index module_deadlines_module_key_idx on module_deadlines (module_key);

create table deadline_confirmations (
  deadline_id  uuid not null references module_deadlines (id) on delete cascade,
  confirmer_id text not null,
  confirmed_at timestamptz not null default now(),
  primary key (deadline_id, confirmer_id)   -- one vouch per person
);

alter table module_deadlines enable row level security;
alter table deadline_confirmations enable row level security;

-- Anyone signed in can read the board.
create policy "read" on module_deadlines for select using (true);
create policy "read" on deadline_confirmations for select using (true);

-- You may only write rows that say they are yours, and only remove your own. There is no
-- update policy anywhere: the app inserts and deletes, and its repeat-write path is
-- `ON CONFLICT DO NOTHING`, which needs insert alone. Granting update would let a row's
-- owner column be rewritten and buy nothing.
create policy "insert own" on module_deadlines
  for insert with check (auth.uid()::text = submitter_id);
create policy "delete own" on module_deadlines
  for delete using (auth.uid()::text = submitter_id);

create policy "insert own" on deadline_confirmations
  for insert with check (auth.uid()::text = confirmer_id);
create policy "delete own" on deadline_confirmations
  for delete using (auth.uid()::text = confirmer_id);
```

Then tighten the cancellation table the same way — its original policies allowed any client
to insert or delete anything:

```sql
drop policy if exists "insert" on cancellation_reports;
drop policy if exists "delete" on cancellation_reports;
create policy "insert own" on cancellation_reports
  for insert with check (auth.uid()::text = reporter_id);
create policy "delete own" on cancellation_reports
  for delete using (auth.uid()::text = reporter_id);
```

Without `supabase.local.json` the app falls back to `LocalDeadlineStore`: deadlines stay on
the device, so you see your own and nobody else's. That's the honest failure, not a
simulated crowd.

## How ownership is enforced

Sign-in now keeps the student's Supabase **access and refresh tokens in the Keychain**
(`SupabaseSession`), and every write to PostgREST is sent as that student rather than as the
anonymous key. `auth.uid()` is therefore a real identity the database can check, which is
what makes `delete own` above mean something — the app hiding the delete button is no longer
the only thing standing in the way.

- Tokens are stored `…ThisDeviceOnly`, so a session can't ride an iCloud backup onto another
  device.
- The access token is refreshed automatically a minute before it expires; if the refresh
  token is dead the session is cleared and the student signs in again.
- Nothing is stored in `UserDefaults` but the user id and address, neither of which is a
  credential.
- `reporterID` is the Supabase user id, so one vote per **account** rather than per install.

## Coloured borders in the timetable

A class is outlined **only on the exact day** something falls, in both the day list and the
week calendar. `DeadlineRules.highlight` decides, and the order matters:

| Border | Means | Beats |
| --- | --- | --- |
| **Orange** | reported cancelled by 3+ people | everything — turning up for a quiz that isn't running is the worst outcome |
| **Blue** | a quiz or exam sat in that class | an assignment the same day |
| **Yellow** | an assignment, lab report or presentation due | — |

A highlight also outranks the faint orange clash outline. Colours are mapped in one place
(`ClassHighlight+UI`), so the list and the calendar can't disagree about what yellow means.

## Where a deadline appears

A deadline is submitted from a class's page and pinned to that class (`at_group_key`, a
`TimetableEvent.groupKey`):

- **At the very top of that class's page** — "Lab report due at this class" — and nowhere
  else. Monday's lecture doesn't headline what's handed in at Thursday's practical.
- **At the bottom of every class's page in that module**, under "All EEG1001 dates", which is
  the full list of assignments, quizzes and exams regardless of which class they're pinned to.
- **As a border** on the pinned class, on the due day only.

Rows written before pinning existed (`at_group_key` null) are treated as module-wide: they
appear at the top of, and colour, every class in the module on that day.

## How a deadline earns trust

A date typed by one person reads **"1 person has confirmed"**, not as fact. Other students
press **This is right** and the count climbs — "2 people have confirmed", "11 people have
confirmed" — always the real number, because eleven people agreeing is worth more than three
and capping the wording would hide that. `DeadlineRules.confirmThreshold` (3, counting the
submitter, whose submission auto-confirms) only decides when the row is **flagged**: at that
point the question mark becomes a green seal. Vouches are de-duplicated by person, in the app
and by the composite primary key.

## Limits worth knowing

- **A confirmed deadline is still only a claim by students.** Three people can agree and be
  wrong; the module's own Loop page remains the authority. The UI never says "official".
- **Nothing expires on its own.** Deadlines due before today are no longer fetched — both the
  query and the client filter cut at `DeadlineRules.horizon` — but the rows stay in the table.
  `supabase/schema.sql` ends with the delete to run periodically.
