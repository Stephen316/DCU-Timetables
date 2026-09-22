// Deliberately NOT `server-only`: this file holds a schema and pure functions, no key and
// no database access. Keeping it importable outside Next is what lets the same schema and
// the same validators be run from a harness — a measurement of different code would not
// tell you anything about this code.
import { Type } from "@google/genai";

/// A lab rotation session, matching `EngineeringLabRotation.json` in the app so an
/// extraction can be diffed against the 67 sessions already verified by hand.
export type RotationSession = {
  week: number | null;
  date: string | null;
  day: string | null;
  start: string | null;
  end: string | null;
  module: string | null;
  groups: string[] | null;
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
          groups: {
            type: Type.ARRAY,
            nullable: true,
            items: { type: Type.STRING, enum: [...ENGINEERING_ROTATION.groups] },
            description: "Every group letter attending this session.",
          },
        },
        required: ["week", "date", "day", "start", "end", "module", "groups"],
      },
    },
  },
  required: ["sessions"],
};

export type Finding = {
  level: "error" | "warn" | "info";
  message: string;
  row?: number;
};

/// Checks the schema cannot express, because they hold across rows rather than within one.
///
/// These are the ones that catch grid misalignment — a cell read correctly and attributed to
/// the wrong row produces perfectly valid values in every field, so only a relationship
/// between rows reveals it. Every check here passes on the hand-verified rotation file.
export function validateRotation(sessions: RotationSession[]): Finding[] {
  const findings: Finding[] = [];
  if (sessions.length === 0) return [{ level: "error", message: "No sessions extracted." }];

  // Illegible cells. Not an error — this is the model correctly declining to guess — but
  // every one needs a human before it can go live.
  sessions.forEach((s, i) => {
    const missing = Object.entries(s)
      .filter(([, v]) => v === null || (Array.isArray(v) && v.length === 0))
      .map(([k]) => k);
    if (missing.length) {
      findings.push({ level: "warn", row: i + 1, message: `Unreadable: ${missing.join(", ")}` });
    }
  });

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

  if (!findings.some((f) => f.level === "error")) {
    findings.unshift({
      level: "info",
      message: `${sessions.length} sessions, all cross-checks passed.`,
    });
  }
  return findings;
}
