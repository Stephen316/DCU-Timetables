// The words that turn a timetable document into rows.
//
// Shared by the console and the harness, so a score from the harness is a score for the
// console — not for a copy with slightly different wording. The same file, imported twice.

export const TRANSCRIBE_SYSTEM = `
You transcribe timetable tables. You do not interpret them.

Rules, in order of importance:

1. If a cell is not clearly legible, emit null for that field. Never infer a value from
   surrounding rows, from what would be consistent, or from what a timetable usually looks
   like. A null is a correct answer; a plausible guess is not.
2. Emit one object per scheduled session actually printed in the document. Do not
   interpolate sessions that "should" be there, and do not merge two rows that look similar.
3. Do not correct apparent mistakes in the source. If the document says a room that seems
   wrong, transcribe what it says.
4. Use only the values permitted by the schema. If the document shows something outside
   them, emit null rather than the closest match.
`.trim();

/// This said "every lab session" until 23 Sep 2026. Only two of the rotation's four
/// columns are headed "Lab", and Mistral Small took the word literally: it transcribed
/// those two perfectly and skipped Workshop and Drawing. The wording was measuring
/// obedience to an ambiguity, not reading. With this wording: 67/67 in 8 of 9 runs; the
/// ninth, from identical input, scored 56/67 and was blocked by the validators.
///
/// Not added, deliberately: "a blank cell or one marked N/A is not a session". It removed
/// the 14 rows Mistral emits for blank cells, and it cost two real sessions — 65/67,
/// identical across two runs. Losing a session is the worst outcome available, so the
/// blanks are handled in code instead (they carry no groups, and are not saved).
export const TRANSCRIBE_INSTRUCTION =
  "Transcribe every session in this rotation table, from every column — one object per " +
  "filled cell. `activity` is the heading the cell sits under. Where a cell lists several " +
  "groups, put all of them in `groups`.";
