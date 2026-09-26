// Deliberately NOT `server-only`: this file holds a schema and pure functions, no key and
// no database access. Keeping it importable outside Next is what lets the same schema and
// the same validators be run from a harness — a measurement of different code would not
// tell you anything about this code.
import { Type } from "@google/genai";

/// A lab rotation session, matching `EngineeringLabRotation.json` in the app so an
/// extraction can be diffed against its 67 sessions.
///
/// That file is only ground truth because it was checked against the PDF itself, by eye,
/// on 23 Sep 2026. Before then it was "hand-verified" and wrong in 35 of 67 sessions —
/// see docs/ENGINEERING_LABS.md. A reference is as good as the last time someone
/// compared it with the source.
export type RotationSession = {
  week: number | null;
  date: string | null;
  day: string | null;
  start: string | null;
  end: string | null;
  module: string | null;
  /// The column heading the session sits under: "Workshop", "Drawing" or "Lab".
  activity: string | null;
  groups: string[] | null;
  /// Never read from a document — the schema has no room. Present only on a session loaded
  /// back from the database that had one, and absent otherwise, so re-saving a reused
  /// rotation keeps it and the "Unreadable" check never sees a missing room as a gap.
  room?: string;
};

/// The vocabularies a document is allowed to draw from.
///
/// These are the whole point. An `enum` in the response schema is not a validation rule the
/// model may fail — it constrains generation, so `SG26` cannot be produced at all. That
/// removes an entire class of error before it exists, which post-hoc checking cannot.
///
/// The cost is that constraining output makes guessing mandatory: faced with a smudged cell
/// and three permitted values, a model with no other option picks one. Every field is
/// therefore nullable, and the system instruction authorises using it. Without that, this
/// schema would convert "illegible" into "confidently wrong" — the one failure mode nothing
/// downstream can detect.
export const ENGINEERING_ROTATION = {
  modules: ["EEG1001", "EEG1002", "EEG1004"],
  days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  starts: ["09:00", "14:00"],
  ends: ["12:00", "17:00"],
  groups: ["A", "B", "C", "D", "E"],
  activities: ["Workshop", "Drawing", "Lab"],
  /// Which activity runs under which module heading, read off the PDF's two header rows.
  /// EEG1001 is one merged heading over two columns; each lab has a heading of its own.
  columns: [
    { module: "EEG1001", activity: "Workshop" },
    { module: "EEG1001", activity: "Drawing" },
    { module: "EEG1004", activity: "Lab" },
    { module: "EEG1002", activity: "Lab" },
  ],
  weeks: { min: 2, max: 12 },
} as const;

export const rotationSchema = {
  type: Type.OBJECT,
  properties: {
    sessions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          week: {
            type: Type.INTEGER,
            nullable: true,
            description: `Teaching week number, ${ENGINEERING_ROTATION.weeks.min}-${ENGINEERING_ROTATION.weeks.max}.`,
          },
          date: {
            type: Type.STRING,
            nullable: true,
            description: "Calendar date of the session as YYYY-MM-DD.",
          },
          day: { type: Type.STRING, enum: [...ENGINEERING_ROTATION.days], nullable: true },
          start: { type: Type.STRING, enum: [...ENGINEERING_ROTATION.starts], nullable: true },
          end: { type: Type.STRING, enum: [...ENGINEERING_ROTATION.ends], nullable: true },
          module: { type: Type.STRING, enum: [...ENGINEERING_ROTATION.modules], nullable: true },
          activity: {
            type: Type.STRING,
            enum: [...ENGINEERING_ROTATION.activities],
            nullable: true,
            description: "The column heading the session sits under.",
          },
          groups: {
            type: Type.ARRAY,
            nullable: true,
            items: { type: Type.STRING, enum: [...ENGINEERING_ROTATION.groups] },
            description: "Every group letter attending this session.",
          },
        },
        required: ["week", "date", "day", "start", "end", "module", "activity", "groups"],
      },
    },
  },
  required: ["sessions"],
};

/// The rows the reader emitted for cells the document leaves empty, found by checking them
/// against the OCR text rather than by asking the model.
///
/// Mistral emits some blank and "N/A" cells as sessions with `groups: null` — 14 on the
/// 2026/27 engineering rotation, all of them empty on the page — and null is also how it
/// marks a cell it could not read. Telling it not to (see transcribe.ts) cost real sessions.
/// But the model reads only this text, so the text settles it: on each dated row, count the
/// cells that hold anything besides the date, week and day, and compare with the sessions
/// that have groups. Equal means every filled cell is accounted for and the nulls are blanks.
/// Anything else — a count that differs, a date the text doesn't have, or the same date on
/// two rows — keeps the null rows, and the warning with them.
export function blankInSource(sessions: RotationSession[], text: string): Set<RotationSession> {
  const filled = new Map<string, number>();
  for (const line of text.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    const d = cells.map((c) => c.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)).find(Boolean);
    if (!d) continue;
    const date = `${d[3]}-${d[2].padStart(2, "0")}-${d[1].padStart(2, "0")}`;
    const n = cells.filter((c) =>
      c && c !== d[0] && !/^\d+$/.test(c) && !/^(mon|tue|wed|thu|fri|sat|sun)\b/i.test(c) && !/^n\/?a$/i.test(c),
    ).length;
    filled.set(date, filled.has(date) ? -1 : n);
  }

  const blank = new Set<RotationSession>();
  for (const s of sessions) {
    if (s.groups?.length || !s.date) continue;
    const withGroups = sessions.filter((o) => o.date === s.date && o.groups?.length).length;
    if (filled.get(s.date) === withGroups) blank.add(s);
  }
  return blank;
}

export type Finding = {
  level: "error" | "warn" | "info";
  message: string;
  row?: number;
};

/// Checks the schema cannot express, because they hold across rows rather than within one.
///
/// These are the ones that catch grid misalignment — a cell read correctly and attributed to
/// the wrong row produces perfectly valid values in every field, so only a relationship
/// between rows reveals it. Every check here passes on the corrected rotation file.
export function validateRotation(sessions: RotationSession[]): Finding[] {
  const findings: Finding[] = [];
  if (sessions.length === 0) return [{ level: "error", message: "No sessions extracted." }];

  // Illegible cells. Not an error — this is the model correctly declining to guess — but
  // every one needs a human before it can go live.
  //
  // Rows whose only gap is `groups` are gathered into one finding. Blank cells the reader
  // emitted are gone by now (blankInSource), so what is left here is a null the OCR text
  // could not account for — most likely a cell that could not be read.
  const noGroups: number[] = [];
  sessions.forEach((s, i) => {
    const missing = Object.entries(s)
      .filter(([, v]) => v === null || (Array.isArray(v) && v.length === 0))
      .map(([k]) => k);
    if (missing.length === 1 && missing[0] === "groups") noGroups.push(i + 1);
    else if (missing.length) {
      findings.push({ level: "warn", row: i + 1, message: `Unreadable: ${missing.join(", ")}` });
    }
  });
  if (noGroups.length) {
    findings.push({
      level: "warn",
      message:
        `${noGroups.length} row${noGroups.length === 1 ? " has" : "s have"} no groups (row ` +
        `${noGroups.join(", ")}) that the document's own text doesn't show as blank — most ` +
        `likely cells that could not be read. A session ` +
        `with no groups reaches no one and is not saved; check the document if any should ` +
        `have one.`,
    });
  }

  // A date and a weekday name are two independent readings of the same fact, so disagreement
  // means one of them is wrong. This caught nothing on the verified file — 0 of 67 — which
  // is what makes a failure here meaningful.
  sessions.forEach((s, i) => {
    if (!s.date || !s.day) return;
    const parsed = new Date(`${s.date}T12:00:00Z`);
    if (Number.isNaN(parsed.getTime())) {
      findings.push({ level: "error", row: i + 1, message: `Unparseable date "${s.date}".` });
      return;
    }
    const actual = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][parsed.getUTCDay()];
    if (actual !== s.day) {
      findings.push({
        level: "error",
        row: i + 1,
        message: `${s.date} is a ${actual}, but the row says ${s.day}.`,
      });
    }
  });

  // Start and end are paired in the source: 09:00-12:00 or 14:00-17:00. A mismatched pair
  // means one of the two was misread.
  sessions.forEach((s, i) => {
    if (!s.start || !s.end) return;
    const expected = s.start === "09:00" ? "12:00" : "17:00";
    if (s.end !== expected) {
      findings.push({
        level: "error",
        row: i + 1,
        message: `${s.start} should end ${expected}, not ${s.end}.`,
      });
    }
  });

  // The strongest check available, and the only one that catches a group letter attributed
  // to the wrong row: every group attends the same number of sessions. On the verified file
  // that is exactly 21 each for A-E. One misread letter breaks the balance.
  const counts = new Map<string, number>();
  for (const s of sessions) for (const g of s.groups ?? []) counts.set(g, (counts.get(g) ?? 0) + 1);
  const seen = [...counts.values()];
  if (seen.length > 1 && Math.min(...seen) !== Math.max(...seen)) {
    const detail = [...counts.entries()].sort().map(([g, n]) => `${g}:${n}`).join(" ");
    findings.push({
      level: "error",
      message: `Groups should appear an equal number of times. Got ${detail}.`,
    });
  }

  // Week numbering runs at a constant offset from the ISO week. A week number read from the
  // wrong row breaks the offset without breaking anything else.
  const offsets = new Set<number>();
  for (const s of sessions) {
    if (s.week === null || !s.date) continue;
    const d = new Date(`${s.date}T12:00:00Z`);
    if (Number.isNaN(d.getTime())) continue;
    const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    const iso = Math.ceil(((d.getTime() - jan4.getTime()) / 86_400_000 + jan4.getUTCDay() + 1) / 7);
    offsets.add(iso - s.week);
  }
  if (offsets.size > 1) {
    findings.push({
      level: "error",
      message: `Week numbers drift against their dates (offsets ${[...offsets].sort().join(", ")}). Expected one.`,
    });
  }

  // A module and an activity that are each legal can still be a column that does not
  // exist. "EEG1004 Drawing" is exactly the mistake the bundled file carried for weeks.
  const columnKey = (m: string, a: string) => `${m} ${a}`;
  const columns = new Set(ENGINEERING_ROTATION.columns.map((c) => columnKey(c.module, c.activity)));
  sessions.forEach((s, i) => {
    if (s.module && s.activity && !columns.has(columnKey(s.module, s.activity))) {
      findings.push({
        level: "error",
        row: i + 1,
        message: `${s.module} has no ${s.activity} column in this rotation.`,
      });
    }
  });

  // Every check above looks across rows; none of them notices rows that are not there. A
  // rotation with a whole column missing is perfectly consistent with itself. Mistral Small
  // returned the two lab columns and skipped Workshop and Drawing — 22 of 67 sessions — and
  // passed all of them. So every column must appear, and every group must meet every one.
  //
  // "Every group" means every group the document actually uses, not every letter the
  // vocabulary allows. The 2026/27 PDF prints a group E that has no students — the cohort
  // is four groups of ~52 — and a reissued PDF without it would be correct. Demanding the
  // vocabulary's E would block exactly that document.
  const present = new Set(sessions.flatMap((s) => s.groups ?? []));
  const attends = new Map<string, Set<string>>();
  for (const s of sessions) {
    if (!s.module || !s.activity) continue;
    const key = columnKey(s.module, s.activity);
    for (const g of s.groups ?? []) attends.set(key, (attends.get(key) ?? new Set()).add(g));
  }
  for (const c of ENGINEERING_ROTATION.columns) {
    const key = columnKey(c.module, c.activity);
    const groups = attends.get(key);
    if (!groups) {
      findings.push({
        level: "error",
        message: `No ${key} sessions at all — a whole column may have been skipped.`,
      });
      continue;
    }
    const absent = [...present].sort().filter((g) => !groups.has(g));
    if (absent.length) {
      findings.push({
        level: "error",
        message: `Group ${absent.join(", ")} never attend ${key}.`,
      });
    }
  }

  if (!findings.some((f) => f.level === "error")) {
    findings.unshift({
      level: "info",
      message: `${sessions.length} sessions, all cross-checks passed.`,
    });
  }
  return findings;
}
