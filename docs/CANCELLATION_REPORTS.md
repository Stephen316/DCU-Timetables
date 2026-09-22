# Crowd-sourced "lecture cancelled" reports

Students report that a class isn't running. Once **3 independent devices** report the same
occurrence, it's flagged with an orange box and a `!` in both the day view and the calendar.

## How it decides

`CancellationRules` (Core, pure, unit-tested) owns the two decisions that matter:

- **What counts as "the same lecture".** The key is `activity code + exact start time`
  (`EEG1007[1]OC/L3/01|2026-09-16T08:00:00Z`), **not** the API's event identity — that isn't
  guaranteed stable between queries, and if it changed the same lecture would split into two
  buckets and never reach the threshold.
- **What counts as a vote.** Reports are de-duplicated by an anonymous per-install
  `reporterID`, so one person reporting five times still counts once. The database enforces
  the same rule with a composite primary key.

Reporting is a toggle — a mistaken report can be withdrawn.

## Privacy

Reports carry **no name, account or student number** — only a random UUID generated on first
launch and kept in `UserDefaults`. It exists solely to stop one device flagging a class alone.

## Supabase setup (one-off)

1. Create a free project at supabase.com.
2. Run this in the SQL editor:

```sql
create table cancellation_reports (
  event_key   text not null,
  reporter_id text not null,
  reported_at timestamptz not null default now(),
  primary key (event_key, reporter_id)   -- one vote per device, enforced by the DB
);

alter table cancellation_reports enable row level security;
create policy "read"   on cancellation_reports for select using (true);
create policy "insert" on cancellation_reports for insert with check (true);
create policy "delete" on cancellation_reports for delete using (true);
```

3. Add `ios/DCUTimetable/Resources/supabase.local.json` (git-ignored by `*.local.json`):

```json
{ "url": "https://YOUR-PROJECT.supabase.co", "anonKey": "YOUR-ANON-KEY" }
```

4. `xcodegen generate` so the file enters the target.

Without that file the app falls back to `LocalCancellationStore` — reports stay on the
device, so nothing ever reaches 3. That's deliberate: better honest and inert than faking a
crowd.

## Limits worth knowing

- **Anyone can report.** The anon key allows inserts from any client, and the only abuse
  control is one-vote-per-install — a determined person could reinstall or script the API.
  Rate limiting or device attestation would be the next step if it's abused.
- **Orange is overloaded**: clashes already use orange. A crowd-reported cancellation draws a
  solid orange box and takes precedence over the fainter clash outline.
- Reports are never cleared; old rows for past classes accumulate. A scheduled delete of rows
  older than a week would keep the table small.
