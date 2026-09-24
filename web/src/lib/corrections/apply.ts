// Corrections to a class list or rotation that is waiting to be accepted.
//
// The model never rewrites the table. It answers a follow-up with a few operations —
// leave row 58 out, set row 12's Group to B, swap two columns — and this code carries them
// out, so the 207 rows that nobody mentioned stay exactly as they were read. Each
// operation is logged in words and shown on the new proposal.
//
// Not `server-only`: pure, and exercised with tsx.

import type { Finding, RotationSession } from "@/lib/extraction/rotation";
import { normaliseStudentId, type RosterRow } from "@/lib/roster/parse";

export type Op = {
  op: "exclude" | "set" | "swap";
  row: number | null;
  field: string | null;
  value: string | null;
  field2: string | null;
  reason: string;
};

type RosterField = Exclude<keyof RosterRow, "row">;
type SessionField = keyof RotationSession;

export const ROSTER_COLUMNS: [string, RosterField][] = [
  ["Surname", "surname"], ["First Name", "given"], ["Student ID", "studentId"], ["Group", "group"],
  ["Sub-group", "subgroup"], ["Day", "day"], ["Workshop", "workshop"], ["Drawing", "drawing"],
];

export const ROTATION_COLUMNS: [string, SessionField][] = [
  ["Week", "week"], ["Date", "date"], ["Day", "day"], ["Start", "start"], ["End", "end"],
  ["Module", "module"], ["Activity", "activity"], ["Groups", "groups"],
];

/// The table as the model is shown it: a row number, then the cells.
export function rosterTable(rows: RosterRow[]) {
  return rows.map((r) => ({ row: r.row, cells: ROSTER_COLUMNS.map(([, f]) => r[f]) }));
}

/// A rotation has no source line numbers, so its rows are numbered in order, 1 up.
export function rotationTable(sessions: RotationSession[]) {
  return sessions.map((s, i) => ({
    row: i + 1,
    cells: ROTATION_COLUMNS.map(([, f]) => f === "groups" ? (s.groups ?? []).join(" ") : (s[f] as string | number | null)),
  }));
}

const clean = (v: string | null) => (v ?? "").trim() || null;

export function applyToRoster(rows: RosterRow[], ops: Op[]): { rows: RosterRow[]; log: Finding[] } {
  let out = rows.map((r) => ({ ...r }));
  const log: Finding[] = [];
  const field = (name: string | null) => ROSTER_COLUMNS.find(([c]) => c === name)?.[1];
  const who = (r: RosterRow) => [r.given, r.surname].filter(Boolean).join(" ") || r.studentId || "";

  for (const o of ops) {
    if (o.op === "swap") {
      const a = field(o.field), b = field(o.field2);
      if (!a || !b || a === b) { log.push(notApplied(o)); continue; }
      out = out.map((r) => ({ ...r, [a]: r[b], [b]: r[a] }));
      log.push({ level: "info", message: `Swapped ${o.field} and ${o.field2} in every row.` });
      continue;
    }
    const target = out.find((r) => r.row === o.row);
    if (!target) { log.push(notApplied(o)); continue; }
    if (o.op === "exclude") {
      out = out.filter((r) => r !== target);
      log.push({ level: "warn", row: target.row, message: `Left out${who(target) ? ` (${who(target)})` : ""}: ${o.reason}` });
      continue;
    }
    const f = field(o.field);
    if (!f) { log.push(notApplied(o)); continue; }
    const before = target[f];
    const after = f === "studentId" ? normaliseStudentId(o.value) : clean(o.value);
    if (before === after) continue;
    (target as Record<string, unknown>)[f] = after;
    log.push({ level: "info", row: target.row, message: `${o.field}: ${before ?? "—"} → ${after ?? "—"}${o.reason ? ` (${o.reason})` : ""}` });
    keepGroupInStep(target, f, log);
  }
  return { rows: out, log };
}

export function applyToRotation(sessions: RotationSession[], ops: Op[]): { sessions: RotationSession[]; log: Finding[] } {
  // Numbered as the model saw them, before anything was left out, so "rows 3 and 5" means
  // the same two sessions however the operations are ordered.
  let out = sessions.map((s, i) => ({ n: i + 1, s: { ...s, groups: s.groups ? [...s.groups] : s.groups } }));
  const log: Finding[] = [];
  const field = (name: string | null) => ROTATION_COLUMNS.find(([c]) => c === name)?.[1];
  const what = (s: RotationSession) => [s.date, s.start, s.module, s.activity].filter(Boolean).join(" ");

  for (const o of ops) {
    if (o.op === "swap") {
      const a = field(o.field), b = field(o.field2);
      if (!a || !b || a === b || a === "groups" || b === "groups" || a === "week" || b === "week") { log.push(notApplied(o)); continue; }
      out = out.map(({ n, s }) => ({ n, s: { ...s, [a]: s[b], [b]: s[a] } }));
      log.push({ level: "info", message: `Swapped ${o.field} and ${o.field2} in every row.` });
      continue;
    }
    const target = out.find((x) => x.n === o.row);
    if (!target) { log.push(notApplied(o)); continue; }
    if (o.op === "exclude") {
      out = out.filter((x) => x !== target);
      log.push({ level: "warn", message: `Row ${target.n} left out (${what(target.s)}): ${o.reason}` });
      continue;
    }
    const f = field(o.field);
    if (!f) { log.push(notApplied(o)); continue; }
    const s = target.s as Record<string, unknown>;
    const before = f === "groups" ? (target.s.groups ?? []).join(" ") : s[f];
    let after: unknown = clean(o.value);
    if (f === "groups") after = (o.value ?? "").toUpperCase().split(/[^A-Z0-9.]+/).filter(Boolean);
    if (f === "week") {
      const n = Number(o.value);
      if (!Number.isInteger(n)) { log.push(notApplied(o)); continue; }
      after = n;
    }
    s[f] = after;
    const shown = f === "groups" ? (after as string[]).join(" ") : after;
    log.push({ level: "info", message: `Row ${target.n} ${o.field}: ${before || "—"} → ${shown || "—"}${o.reason ? ` (${o.reason})` : ""}` });
  }
  return { sessions: out.map((x) => x.s), log };
}

/// A subgroup names its group: B.1 is in B. Setting one, or a combined "B.1" typed as the
/// group, brings the other along, as parseRoster does for an upload — otherwise "move Fay to
/// B.1" leaves her in B.1 of group A, and the app looks her labs up under A.
function keepGroupInStep(r: RosterRow, changed: RosterField, log: Finding[]) {
  const combined = r.group?.match(/^([A-Za-z])\.(\d{1,2})$/);
  if (changed === "group" && combined) {
    const was = r.subgroup;
    r.subgroup = r.group!.toUpperCase();
    r.group = combined[1].toUpperCase();
    log.push({ level: "info", row: r.row, message: `Read as group ${r.group}, sub-group ${r.subgroup}${was && was !== r.subgroup ? ` (was ${was})` : ""}.` });
    return;
  }
  const letter = r.subgroup?.match(/^([A-Za-z])\.\d{1,2}$/)?.[1]?.toUpperCase();
  if (changed === "subgroup" && letter && r.group?.toUpperCase() !== letter) {
    log.push({ level: "info", row: r.row, message: `Group: ${r.group ?? "—"} → ${letter}, to match sub-group ${r.subgroup}.` });
    r.group = letter;
  }
}

function notApplied(o: Op): Finding {
  return {
    level: "warn",
    message: `Not applied — ${o.op}${o.row != null ? ` row ${o.row}` : ""}${o.field ? ` ${o.field}` : ""}: no such ${o.row != null ? "row or column" : "column"}.`,
  };
}
