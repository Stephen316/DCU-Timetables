# CSV conversion pipeline and course resolution — plan

Working from `CSV Conversion Pipeline` (Mermaid, 21 Sep 2026). That diagram gets the shape
right; this fills in what it leaves open and sequences the build.

**Decisions taken (21 Sep 2026):**

1. **Option C** — pseudonymised roster on the device, opaque `allocation_key`, name→key map
   server-side.
2. **Match on given name + family name**, not surname alone.
3. **Course is selected first**, so a match is only ever attempted within one course's roster.
4. **Local first.** Qwen3-VL and PaddleOCR on the 32 GB desktop, no Claude API. A Gemini
   adjudication step for disputed *structural* cells is designed in but **not committed** —
   whether it's built at all depends on what the §6 step 2 harness measures.

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

## 4. The pipeline — local by default

Everything runs locally on the **32 GB desktop**. No API key, no network, no per-document
judgement call about which path a file goes down.

That last point is the strongest argument for the single path. A two-path design (hosted
model for rotation PDFs, local for class lists) works right up until someone sends a
name-bearing document down the hosted path by mistake. One local path makes that mistake
impossible.

**Model: `qwen3-vl-32b-instruct` at 4-bit (~18 GB).** It fits in the desktop's unified
memory budget (~21–24 GB of 32 GB) with room for KV cache, which matters because a page
image is thousands of tokens before the model writes anything.

Do **not** run this on the 16 GB laptop. There the ceiling is 8B, and 8B is materially
worse on merged cells and grid alignment — the two things these documents are made of.
macOS swaps rather than refusing to allocate, so an over-budget model doesn't error, it
just becomes unusably slow.

**The honest residual:** 32B narrows the gap to a frontier model on hard table layouts but
doesn't close it. That's what §4.2's validators and §4.3's staging gate are for, and why
the ground-truth measurement in §6 step 2 comes before anything is built on top.

**Workflow:** the repo is on the laptop, the model is on the desktop. Decide up front that
the desktop runs the whole ingestion step — model, validators, CSV output — so the only
thing crossing machines is a finished, validated CSV. Shuttling intermediate files both
ways is what gets a pipeline abandoned after two uses.

Nothing is installed yet — no ollama, no MLX, no PaddleOCR.

### 4.1 Extraction

**Feed the image straight to the model.** Pre-OCRing for a VLM throws away the spatial
layout it needs to make sense of a merged-cell table.

**PaddleOCR and Qwen run in parallel on every page**, and their outputs are diffed. This is
a deliberate choice of accuracy over throughput, and the right one at this volume — a few
documents a year, run attended. (An earlier draft proposed PP-Structure as a triage stage
so clean pages would skip the VLM. That saves real time at scale and buys nothing here,
where the scarce resource is your attention on the review screen, not compute.)

The diff is the detector that matters: digit confusion (`SG23`/`SG24`/`SG25`,
`SB38`/`SB39`) is the dominant error mode, it produces a perfectly well-formed value that
no schema check can see, and two independent systems rarely make the same one.

**Disputed cells go to adjudication.** A cell is disputed when the two extractions disagree
or a validator fails.

**The default resolution is you.** Disputed cells land on the review screen and you decide.
At this volume that may be the whole answer — if the harness shows the local pair agreeing
on 99% of cells, a handful of disputes per document is a minute's work, and a third model
is machinery you don't need.

**A Gemini adjudication step is drawn in `csv_pipeline.mmd` (subgraph `s3`) but is TBD.**
Build it only if the measured dispute rate makes manual adjudication tedious. The decision
belongs after §6 step 2, not before it.

If it is built, the fork inside it is the privacy boundary and is not optional:

- **Disputed cell is a name** → never leaves the machine; straight to the review screen.
- **Disputed cell is structural** (room, day, time, group letter) → crop it, strip names,
  send only the crop, merge the result and re-validate.

That fork is what makes a hosted model usable here at all. Redaction is impossible
*upstream* of OCR, because the names are in the pixels — but trivial *downstream*, once
local extraction has located the cells. And per §4.5, EEA terms mean even the crop isn't
trained on.

**Cut output tokens, not input tokens.** `day`, `workshop` and `drawing` are a function of
`subgroup`, so have the model emit only `name, subgroup` and derive the rest locally.
Roughly 3× less decode. Emit CSV, not JSON.

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
messy inputs, this gate matters more here than anywhere else in the console — and if the
Gemini step in §4.1 is never built, it is the *only* thing standing between a misread cell
and 200 students in the wrong room.

### 4.4 Note on the allocation itself

Engineering Year 1's allocation is **not alphabetical** — sorting by name gives 155 runs
(by family name) or 148 (by given name), against the 4 you'd see if it were. So a split
rule cannot replace this roster. Other courses may well be alphabetical; check before
building a roster for them, because a rule needs no personal data at all.

### 4.5 If the Gemini step is built — the EEA carve-out

Google's free-tier terms say submitted content is used to improve their products, and warn
against sending sensitive data. But the same terms carry an exception, quoted from
`ai.google.dev/gemini-api/terms`:

> "If you're in the European Economic Area, Switzerland, or the United Kingdom, the terms
> under 'How Google uses Your Data' in 'Paid Services' apply to all Services, including
> Google AI Studio and unpaid quota in the Gemini API"

And the paid terms: Google "doesn't use your prompts ... or responses to improve our
products." As an EEA user you get paid-tier data handling on free quota. That's what makes
a free-tier hosted adjudicator defensible at all — it does **not** remove the §4.1 crop
rule, which stands regardless.

Two caveats: free tier is reportedly Flash-only since March 2026, with Pro behind a
subscription; and use the API with structured output rather than Gemini CLI, which is an
interactive agent and a poor fit for a reproducible batch step.

---

## 5. Still to decide

- ~~**Re-upload.**~~ Answered: `csv_pipeline.mmd` `n36 -.-> n9` re-resolves on import, and
  the §2.0 HMAC keeps keys stable so only genuinely changed rows move. Still needs the
  cheap version check at launch to trigger it.
- **The HMAC secret.** Where it lives, how it rotates, and who can read it — §2.0 sets the
  requirements but not the mechanism.
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
2. **Ground-truth harness first.** `EngineeringLabRotation.json` is a verified extraction of
   a PDF you still have: 67 sessions, and every validator in §4.2 passes on it. Run
   `qwen3-vl-32b` against that same PDF and diff. This gives a measured accuracy figure for
   this document class on this hardware **before** anything is built on top of it.
3. **Local extraction script** (`tools/`): image → Qwen3-VL + PaddleOCR in parallel → diff →
   §4.2 validators → CSV. Standalone, testable against one real page before any of it
   touches the console.
4. **Decide on Gemini.** With 2 and 3 measured you'll know the dispute rate. Low enough that
   the review screen absorbs it → don't build `s3` at all. High enough to be tedious → build
   it with the §4.1 crop rule.
5. **Schema for §2** — `roster_members`, `course_allocations`, `resolve_allocation`, and the HMAC secret.
6. **Console upload + staging + review screen** (`ADMIN_CONSOLE.md` §7.2).
7. **App reader**: call the RPC, cache the allocation key, drop the local matcher. *(iOS — needs your
   go-ahead.)*
