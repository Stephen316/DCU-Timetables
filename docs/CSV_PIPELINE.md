# CSV conversion pipeline and course resolution — plan

Working from `CSV Conversion Pipeline` (Mermaid, 21 Sep 2026). That diagram gets the shape
right; this fills in what it leaves open and sequences the build.

**Decisions taken (21 Sep 2026):**

1. **Option C** — pseudonymised roster on the device, opaque `allocation_key`, name→key map
   server-side.
2. **Match on given name + family name**, not surname alone.
3. **Course is selected first**, so a match is only ever attempted within one course's roster.
4. **Gemini extracts, PaddleOCR cross-checks.** Free tier, under the §4.5 EEA terms. Local
   Qwen is out — see §4 for why that scaffolding was removed rather than kept.

4 supersedes `ADMIN_CONSOLE.md` §7.3 entirely; 1–3 replace the §7.4 position that nothing
personal is hosted.

---

## 1. Why the matching works

Measured against the Engineering Year 1 list (`local-data/`, 207 students):

- **Zero full-name collisions.** Given + family name uniquely identifies every student.
- **Family name alone would not.** 62 of 207 share a family name with someone else; the
  worst is shared by 9. This is why the key is both names.
- Scoping to the selected course shrinks the space further — the match runs against ~207
  rows, not the whole university.

`DCUEmail` (`ios/DCUTimetable/Core/Models/DCUEmail.swift`) already derives this: it splits
the local part on dots, strips the trailing disambiguation digit, and exposes `givenName`,
`familyName` and `displayName`.

**Still handle the collision case.** 207 students with no clash doesn't mean a 400-student
cohort won't have one, and the failure is silent — the wrong person's lab group, with no
error. Where two rows match, fall back to asking the user **which subgroup they're in**.
Never present a list of candidate names: showing someone nine classmates so they can pick
themselves is a disclosure created by the UI, not by the data store.

---

## 2. Option C in detail

The device holds the roster **pseudonymised** — opaque allocation keys against allocations,
no names. The name→key map never leaves the server.

```
profiles                (server only)
  student_id            text        -- "A00000000", set once at account creation

roster_members          (server only, RLS: admin read)
  course_key            text
  version               int
  allocation_key        bytea       -- HMAC(secret, course_key||name_key||disambig)
  name_key              text        -- normalised "given family"   (nullable)
  student_id            text        -- normalised "A00000000"      (nullable)
  → at least one of name_key / student_id must be present

course_allocations      (anon-readable IN FULL — see §2.0)
  course_key, version
  allocation_key, group, subgroup      -- no names, no IDs
```

At first sign-in, after the user picks their course:

1. Client calls `resolve_allocation(course_key)`.
2. The RPC (`security definer`, `set search_path = ''`) derives the name from
   `auth.jwt() ->> 'email'`, matches it in `roster_members` for that course, and returns
   **the caller's allocation key or null** — never another row, never a count.
3. Client downloads `course_allocations` for the course. It's inert: opaque keys against
   group letters.
4. Client resolves its own row locally and caches it. Offline from then on.

### 2.0 Why `allocation_key` is an HMAC, not a random PI

Earlier drafts used a random PI. `HMAC(secret, course_key || name_key || disambiguator)`,
computed server-side at import, is better, and for a reason the random version couldn't
address:

- **It survives re-import.** A corrected roster re-imported next week produces the *same*
  key for the same person, so every device's cached allocation stays valid. Random PIs
  would be redrawn on every import and silently invalidate all of them.
- **It is not a plain hash.** `ADMIN_CONSOLE.md` §7.4 is right that hashing a name over a
  207-person cohort is brute-forceable in seconds — but that assumes the attacker can
  compute the hash. With an HMAC they cannot: the secret stays on the server and only the
  output ever reaches a device.

**Two conditions this depends on**, both of which are real work:

1. **The secret is a key, not a config value.** Not in the repo, not in the client bundle,
   rotatable. If it leaks, every `allocation_key` becomes reversible immediately, because
   the name space behind it is tiny. Rotating it invalidates every cached allocation — the
   same cost the random scheme would have paid on every import.
2. **The course must be in the input.** `course_allocations` is readable by anyone holding
   the anon key — which ships in every app install. The client asks for one course; the
   *database* will serve all of them, and the client's filter is a request, not a
   restriction (the same point as `ADMIN_CONSOLE.md` §3: the app is not the boundary, the
   policy is).

   That full dump is near-harmless on its own — cohort sizes and group structure, no names.
   The danger is **linkage**. Without `course_key` in the input, one student has the *same*
   key in every course they take, so the full dump lets you follow `7d40be…` across
   EEG1001, EEG1002 and EEG1004. Anyone who knows a real classmate's timetable can then
   find the only key matching that combination and read off everything else it holds. A
   thin pseudonymous record is hard to attach to a person; a rich one is not.

   With `course_key` mixed in, the same person gets an unrelated key in every course and
   cross-course linkage is impossible even with the whole table. It costs nothing:
   `resolve_allocation(course_key)` already takes the course, the row count is already
   per-course, and HMAC output is a fixed 32 bytes whatever you feed it.

3. **The HMAC input needs a disambiguator.** `HMAC(secret, name_key)` alone maps two
   students with the same normalised name to the *same* key, which silently merges them
   into one allocation. That is worse than the ambiguity it replaces: §1's "Several" branch
   can at least ask. Feed the roster row's `student_id`, or a per-row sequence number, into
   the HMAC alongside the name so identical names get distinct keys. Engineering Year 1 has
   zero full-name collisions, so this is insurance rather than a live bug — but it is the
   kind that appears silently in a future cohort.

**Store the key as `bytea`, not hex text.** 32 bytes against 68, which is ~45% off that
column and compounds through every index. Irrelevant at 207 rows, awkward to change once
keys exist. Base64url it on the way out if the console needs it readable. For scale: all of
DCU (20k students x 6 modules) is ~9 MB for `course_allocations` and ~13 MB for
`roster_members`; a student downloads ~12 KB for a 207-person course.

One simplification worth noting: this **removes** the client-side matcher in
`ProfileCreatorView.swift:86-104`. Matching happens in exactly one place, server-side, so
there's no second implementation to drift — unlike the `event_key` trap in §6.

**What you take on.** Under C you are the controller of a hosted name→group mapping for a
few hundred people. That needs a lawful basis, a retention limit, and a deletion path
(§5). It is a real obligation, taken knowingly.

### 2.1 Student ID as a second match key

Some lecturers publish allocations keyed by student ID (`A00000000`) with no names in them
at all. That's a second key into the same roster, not a separate system.

**Collected once, at account creation.** The user types it, it's normalised (uppercase,
whitespace stripped, format checked) and written to `profiles.student_id`. It is never
exposed to another user, never sent to a device, and never used as the PI.

**Matching order.** `resolve_allocation(course_key)` uses whichever key that course's roster
carries:

| Roster has | Match on |
|---|---|
| Names only | Given + family name, from the **verified** email |
| Student IDs only | `profiles.student_id` |
| Both | Name first; require the ID to agree. A mismatch is a flag for review, not a fallback |

The ordering matters because the two keys have different strength. The email address is
verified by the Before User Created hook — the student proved they control it. The student
ID is typed in. Anyone can type somebody else's.

**The enumeration oracle, and why the ID is set once.** If the RPC accepted an arbitrary ID
on every call, it would be a lookup service for the whole cohort: submit IDs until one
returns a PI and you've mapped everyone's allocation. Binding the ID to the account at
creation — changeable afterwards only by an admin — gives each account exactly one query,
for its own ID. Without that constraint this feature is a data leak wearing a convenience
hat.

**Why not just hash the IDs and ship those?** Same reason as names, with one difference
worth understanding rather than glossing:

- An ID is letter + 8 digits, which *sounds* like enough entropy to hash safely. It isn't —
  if DCU encodes the entry year in the leading digits, the live space for one cohort is
  small enough to enumerate in milliseconds.
- **But the consequence of reversing it differs.** Recovering a name is self-identifying;
  recovering an ID is not, unless you already hold DCU's ID→name directory. So an ID-keyed
  roster is genuinely less exposing than a name-keyed one.

That's an argument for preferring ID-keyed source documents, **not** an argument for
shipping hashed IDs. Keep the opaque `allocation_key` on the device — per §2.0 its secret
stays server-side, so it doesn't depend on an attacker's resources the way a plain hash
would.

**Never use the student ID as the PI.** The PI is random, disposable and meaningless
outside this app. The ID is permanent, externally meaningful and issued by DCU. Conflating
them would push a real institutional identifier onto every device that downloads an
allocation table.

**One genuine win.** An ID-only document contains no names, so for those courses the
ingestion pipeline never handles personal names at all — which makes the §4 model choice a
much smaller decision for them.

**Extraction validation is different, not easier.** Format (letter + 8 digits) catches
structural OCR errors well, and cohort prefix consistency catches more — one ID whose
leading digits differ from its 200 neighbours is almost certainly a misread. But a single
transposed digit is still a well-formed ID, invisible to every format check, exactly like
the `SB38`/`SB39` problem. The PaddleOCR cross-check stays the detector.

**Deletion and retention (§5) now cover two identifiers**, not one. A student ID raises how
identifying a `profiles` row is, so it belongs in the same retention answer as the roster.

---

## 3. The flow

**The diagram is `docs/csv_pipeline.mmd`. That file is the single source of truth — do not
embed a second copy here or keep working versions elsewhere.**

Three things in it are worth stating in words, because they're decisions rather than
drawing:

**The timetable and the allocation resolve independently, then join.** Losing the roster
match doesn't cost you the general timetable, and an unreachable timetable API doesn't
block allocation. A cached snapshot covers the API being down; only "no cache and no API"
is a hard error.

**`Found?` is three-way, not boolean.** None → general timetable only. One → allocation
returned. Several → ask which subgroup. The "Several" branch must never render a list of
candidate names; showing someone nine classmates so they can pick themselves is a
disclosure created by the UI rather than by the data store.

**Re-import triggers re-resolution.** `n36 -.-> n9` — when a corrected roster lands, devices
re-resolve rather than trusting a stale cache. This is what §5's invalidation question was
asking for, and the HMAC in §2.0 is what makes it cheap.

**One gap:** the diagram matches only on `DCUEmail` given + family name. The student-ID key
in §2.1 isn't drawn yet, so `n50`/`n9` need a second input before that's built.

---

## 4. The pipeline — Gemini, with a local cross-check

**Inputs vary and will keep varying** — a spreadsheet one year, a PDF the next, a photo of a
printout after that. That is the case for a model rather than a parser: a parser needs one
implementation per format and breaks on each new one, where a model takes all of them
through a single path.

**Extractor: the Gemini API, free tier.** The §4.5 EEA carve-out means paid-tier data terms
apply to free quota, so Google does not train on what you send. That, plus option C already
placing these names in Supabase, is what makes it consistent to send name-bearing documents
there rather than a stricter standard applied unevenly.

**Two document types, one extractor, different destinations:**

| Document | Contains names? | Lands in |
|---|---|---|
| Lab rotation (week x group x module x room) | No | `lab_rotations`, public read |
| Class allocation list | Yes, or student IDs | `roster_members` + `course_allocations`, via the §2.0 HMAC |

**What this replaced, and why it's recorded:** earlier drafts ran `qwen3-vl-32b` locally on
a 32 GB desktop, to keep names off third-party infrastructure entirely. Qwen is out. That
design existed to satisfy a constraint that option C had already relaxed, and it cost a
model install, a quantisation quality penalty, and a laptop/desktop split that would have
made the pipeline annoying enough to abandon. None of that scaffolding is needed once the
constraint is lifted deliberately rather than inherited.

### 4.0 The front door

PDFs and images go to Gemini directly. Anything else is normalised first:

- `.xlsx` / `.ods` → CSV (a zip of XML; the model cannot read the file itself)
- `.docx` → text
- `.csv` / pasted text → straight through

Keep this step dumb and deterministic. It is the one part of the pipeline that should never
need a model, and giving it an obvious front door stops "any format" becoming a surprise
later.

### 4.1 Extraction and cross-check

**PaddleOCR PP-Structure runs locally alongside Gemini on every document**, and the two
outputs are diffed. It is free, local, and it catches the error that matters: digit
confusion (`SG23`/`SG24`/`SG25`, `SB38`/`SB39`) produces a perfectly well-formed value that
no schema check can see, and two unrelated systems rarely make the same one.

Keeping it is cheap insurance, not a hedge against Gemini being bad. Drop it only if the §6
harness shows it never disagrees usefully.

**Disputed cells are flagged, not routed elsewhere.** A cell is disputed when the two
extractions disagree or a validator fails. It still goes to `import_staging` — it is just
surfaced first on the review screen. Earlier drafts had a separate adjudication path that
sent disputed *structural* cells to a second model while keeping names local; that whole
mechanism existed to protect names from a hosted model and is obsolete now that extraction
is hosted anyway.

**The adjudicator is you.** At a few documents a year, disputed cells are a minute's work on
the review screen, and a third model is machinery that earns nothing.

### 4.2 Validation before anything is stored

The structure is constrained enough that deterministic checks catch most errors:

- Every `subgroup` is one of the 16 known values.
- Subgroup sizes are near-identical — measured: 13 each, 12 for `D.4`.
- Group sizes near-identical — measured: 52/52/52/51.
- `day`/`workshop`/`drawing` consistent within a subgroup, **with one real exception**: the
  `.3` subgroups split 11 SB38 / 2 SB39, identically in all four groups. That consistency
  means it's deliberate, not noise — don't "correct" it.
- Names contain only plausible characters.

Anything failing goes to a review pile, not the CSV.

### 4.3 Nothing lands live

`ADMIN_CONSOLE.md` §7.2 applies unchanged: extraction → `import_staging` → **review screen
with per-row accept/edit/reject** → commit to live tables plus an `admin_actions` row.
`csv_pipeline.mmd` draws this correctly (`n33` → `n34` → `n36`). With a local model on
messy inputs, this gate matters more here than anywhere else in the console — it is the
only thing standing between a misread cell and 200 students in the wrong room.

### 4.4 Note on the allocation itself

Engineering Year 1's allocation is **not alphabetical** — sorting by name gives 155 runs
(by family name) or 148 (by given name), against the 4 you'd see if it were. So a split
rule cannot replace this roster. Other courses may well be alphabetical; check before
building a roster for them, because a rule needs no personal data at all.

### 4.5 The EEA carve-out — why the free tier is usable here

Google's free-tier terms say submitted content is used to improve their products, and warn
against sending sensitive data. But the same terms carry an exception, quoted from
`ai.google.dev/gemini-api/terms`:

> "If you're in the European Economic Area, Switzerland, or the United Kingdom, the terms
> under 'How Google uses Your Data' in 'Paid Services' apply to all Services, including
> Google AI Studio and unpaid quota in the Gemini API"

And the paid terms: Google "doesn't use your prompts ... or responses to improve our
products." As an EEA user you get paid-tier data handling on free quota. That's what makes
a free-tier hosted extractor defensible at all. Verify it still holds before relying on
it — terms change, and this one is load-bearing for the whole §4 design.

Three caveats:

- **Free tier is reportedly Flash-only** since March 2026, with Pro behind a subscription.
  So the open question is accuracy on your messiest layout, not quota — token limits will
  not be the binding constraint at a few documents a year.
- **Use the API with structured output**, not Gemini CLI. The CLI is an interactive agent
  and a poor fit for a reproducible batch step. It is worth using once, by hand, to see
  whether a given document reads at all.
- **This is a deliberate relaxation.** Names go to Google under processor terms. That is
  consistent with option C hosting them in Supabase, but it is a choice with a legal
  footing, not an absence of one — §2's retention and deletion obligations cover it too.

---

## 5. Still to decide

- ~~**Re-upload.**~~ Answered: `csv_pipeline.mmd` `n36 -.-> n9` re-resolves on import, and
  the §2.0 HMAC keeps keys stable so only genuinely changed rows move. Still needs the
  cheap version check at launch to trigger it.
- **The HMAC secret.** Where it lives, how it rotates, and who can read it — §2.0 sets the
  requirements but not the mechanism.
- **Rotation delivery — done.** The app reads `lab_rotations` from Supabase
  (`LabRotationRefresh`, on launch, sign-in and return to the foreground), caches it on the
  device, and falls back to the bundled `EngineeringLabRotation.json` when nothing is saved
  or on first launch with no signal. A failed request keeps the cached copy. Students on a
  programme they picked, with no group attached, still see every group's lab slots.
- **Timetable changes — done.** For what the rotation doesn't cover, `timetable_changes`
  (supabase/phase17) removes a class or adds one for a group, a subgroup, or everyone on a
  course, on listed dates. Made on the console's Timetable page or proposed from Ask, which
  is given the module's DCU classes, the teaching weeks and what is saved as context (never
  the class list). A removal is checked against DCU's timetable before it saves; an added
  class's times and room must appear in what the admin wrote. The app downloads a course's
  changes with the rotation and applies them on the phone (`TimetableChanges.apply`).
  Students on a picked programme get only the changes for everyone.
- **Programmes as groups — server and console done, app to follow.** EEG1 covers six DCU
  programmes (BMED1, CAM1, CE1, ECE1, ME1, SSE1) that DCU timetables identically, though
  some classes are for one programme only. Each is now a group of the course
  (supabase/phase19, `course_programmes`): a change can be for `BMED1`, and the Timetable
  page's "keep only for" saves a removal for each of the other five in one transaction.
  Ask offers only General Engineering and refuses a change for one programme. The app
  still matches lab groups only, so it skips programme changes until it learns the
  student's programme — it has to read `course_programmes`, show the programme the student
  picked, and match `grp` against it as well as the lab group.
- **Deletion.** A student asks for their row to be removed — needs a path that isn't editing
  the database by hand.
- **Retention.** How long a roster lives after the module ends.
- **The DCU address check is already server-side.** The Before User Created hook enforces it,
  so the client check is UX, not the gate. Worth labelling so nobody later removes the hook
  thinking the client covers it.

---

## 6. Build order

1. **Delete `ios/DCUTimetable/Resources/eng_groups.local.json`.** Independent of everything
   below — the manual picker already handles its absence (`ENGINEERING_LABS.md`). *(iOS —
   needs your go-ahead.)*
2. **Ground-truth harness first, on the rotation document.** `EngineeringLabRotation.json`
   is the reference for a PDF you still hold: 67 sessions. It is the right first target
   because the answer is known, there are no names in it, and the extractor is the same one
   the class lists will use — mistakes here are cheap and measurable.

   ⚠️ *"The answer is known" was wrong until 23 Sep 2026.* The file was described here as a
   verified extraction and every §4.2 validator passed it, but 35 of its 67 sessions carried
   the wrong module (`ENGINEERING_LABS.md`). The harness's first real run found it. The file
   is now checked cell by cell against the rendered PDF, and the validators gained the two
   checks it would have failed: a module/activity pair must be a real column, and every
   column must be attended by every group the document uses.

   *Measured, 23 Sep 2026:* Mistral OCR + `mistral-small-latest` scored **67/67 exact, every
   field correct, in 8 of 9 runs**. The ninth, from byte-identical input, scored 56/67 — the
   model is not fully deterministic at temperature 0, whatever two matching runs suggest —
   and failed the group-balance check, so it could not have been saved. The console reads
   again when the checks fail. It also emits 14 rows with no groups for blank cells; those
   are listed in one warning and not saved. Gemini's run is pending the free-tier quota
   reset.

   **The console now extracts with Mistral**, through the same `extractRotation` the harness
   imports — so the harness scores the console, not a copy of it.
3. **Extraction script** (`tools/`): normalise → Gemini + PaddleOCR → diff → §4.2 validators
   → CSV. Standalone, testable against one real document before any of it touches the
   console.
4. **Decide whether PaddleOCR stays.** With 2 and 3 measured you will know whether it ever
   disagrees usefully. If it doesn't, drop it and simplify.
5. **Schema for §2** — *built 23 Sep 2026*, `supabase/phase13_roster_allocations.sql`.
   `roster_members`, `course_allocations`, `rosters` (title + version), `allocation_flags`,
   `save_roster`, `resolve_allocation`, `set_student_id`. The HMAC secret is generated inside
   the database into Vault and never leaves it; `private.rotate_roster_key()` rotates it and
   re-derives every key. Each row stores the disambiguator it was keyed with, so a rotation
   reproduces the keys an import would. Tested against the live database with synthetic
   accounts in a rolled-back transaction: one match, two same-named students separated by
   subgroup, not listed, ID-only match, both conflict paths flagged once each, the ID set
   once and refused twice, a student refused `save_roster` and `roster_members`, and a
   re-import keeping the same key.

   **Student ID is open on the server, not in the app.** `profiles.student_id` and
   `set_student_id` exist and `resolve_allocation` uses the ID when present, but the app
   does not ask for one yet — every roster so far is keyed by name. A caller with no ID
   matches a name-and-ID row on the name alone: the name is the verified key (§2.1).
6. **Console upload** — *built*, following the diagram's ingestion path. Any file goes into
   the Ask tab:
   - **Normalise (n60)**, `web/src/lib/extraction/normalise.ts`: `.xlsx` to CSV per sheet,
     `.docx` to text with tables as Markdown, text as it is, PDFs and images to Mistral OCR.
     No dependency: both Office formats are zips of XML, read with Node's zlib.
   - **Document type (n62)**: a headed table that already parses as a class list is taken
     as it stands, and the names go to no model. Anything else, the model classifies as
     class list, rotation or neither (`web/src/lib/mistral/roster.ts`).
   - **Class list (n61)**: the model writes it out as CSV with a fixed header; that CSV goes
     through the same parser and validators as an uploaded one.
   - **Rotation**: the transcription the harness measured, on the text already read.
   - **Review (n34)**: the proposal panel, with the CSV downloadable. Accept saves; each name
     is sent as its `name_key`, never as written. Nothing reaches Supabase without Accept.

   Measured 23 Sep 2026, synthetic names only: a messy 24-student list with one "Surname,
   Given" column read 24/24 exact as text and 24/24 through OCR as a PDF; the School's
   rotation PDF classified as a rotation (81 rows, 0 check errors); unrelated prose as
   neither. The real Engineering list parses directly: 207 students, 207 distinct keys,
   groups 52/52/52/51.

   ⚠️ **Names now go to Mistral** for any class list that is not already a headed table.
   §4.5's reasoning was about Gemini's terms; Mistral's have not been checked here. Confirm
   the account does not allow training on API inputs before uploading a real list that way.

   **Emails are account information only.** The name is taken from the verified address
   once, when the account is created, and stored on `profiles` (`given_name`,
   `family_name`, admin-only to change); `resolve_allocation` matches on that and never
   reads the address. Tested by changing a test account's address after sign-up: it still
   matched on the stored name. Because a single name column leaves the model to decide
   which part is the surname, the match accepts the stored name in either order. Not built: PaddleOCR
   cross-check (§4.1), per-row edit, and a screen for `allocation_flags`.
7. **App reader** — *built*: the profile screen offers the uploaded class lists the app can
   build a timetable for, resolves on the server, asks the subgroup when names collide, and
   re-resolves when an upload bumps the version. `EngGroupDirectory` — the on-phone matcher
   and its class-list import — is deleted. Profiles made before this keep working and never
   refresh. *(Approved and built 23 Sep 2026.)*
