// Checks on a parsed class list, before anything is saved.
//
// Errors block saving; warnings are shown and left to the administrator. The database
// repeats the structural ones (save_roster), because a check that only runs in the browser
// is a suggestion.

import type { Finding } from "@/lib/extraction/rotation";
import { nameKey, type RosterRow } from "./parse";

const STUDENT_ID = /^[A-Z][0-9]{8}$/;

export function validateRoster(rows: RosterRow[]): Finding[] {
  const out: Finding[] = [];
  if (rows.length === 0) return [{ level: "error", message: "No students in the list." }];

  for (const r of rows) {
    const key = nameKey(r.given, r.surname);
    if (!key && !r.studentId) {
      out.push({ level: "error", row: r.row, message: "No name and no student ID." });
    }
    if (!r.group) out.push({ level: "error", row: r.row, message: "No group." });
    if (r.studentId && !STUDENT_ID.test(r.studentId)) {
      out.push({ level: "error", row: r.row, message: `${r.studentId} is not a student ID (one letter, eight digits).` });
    }
    // A name missing half can only match an address with the same half missing — i.e.
    // nobody. Worth fixing in the source rather than saving as a row that never resolves.
    if (key && (!r.given || !r.surname) && !r.studentId) {
      out.push({ level: "warn", row: r.row, message: "Only half a name, so this student can't be matched to their address." });
    }
    // "A.1" belongs to group A. Anything else is a misread or a typo in the source.
    if (r.group && r.subgroup && !r.subgroup.toUpperCase().startsWith(r.group.toUpperCase())) {
      out.push({ level: "warn", row: r.row, message: `Subgroup ${r.subgroup} is not in group ${r.group}.` });
    }
  }

  const ids = new Map<string, number[]>();
  for (const r of rows) if (r.studentId) ids.set(r.studentId, [...(ids.get(r.studentId) ?? []), r.row]);
  for (const [id, at] of ids) {
    if (at.length > 1) out.push({ level: "error", message: `${id} appears on rows ${at.join(", ")}.` });
  }

  // Same name twice. Saving still works — each gets its own key — but those students are
  // asked which subgroup they're in, and if both are in the same one nothing can tell
  // them apart.
  const names = new Map<string, RosterRow[]>();
  for (const r of rows) {
    const key = nameKey(r.given, r.surname);
    if (key && !r.studentId) names.set(key, [...(names.get(key) ?? []), r]);
  }
  for (const same of names.values()) {
    if (same.length < 2) continue;
    const subgroups = new Set(same.map((r) => r.subgroup ?? ""));
    const rowsText = same.map((r) => r.row).join(", ");
    out.push(subgroups.size === same.length
      ? { level: "warn", message: `Rows ${rowsText} share a name. They'll be asked which subgroup they're in.` }
      : { level: "error", message: `Rows ${rowsText} share a name and a subgroup, so they can't be told apart. Add student IDs.` });
  }

  const groups = new Map<string, number>();
  for (const r of rows) if (r.group) groups.set(r.group, (groups.get(r.group) ?? 0) + 1);
  out.push({
    level: "info",
    message: `${rows.length} students in ${groups.size} group${groups.size === 1 ? "" : "s"}: ` +
      [...groups].sort().map(([g, n]) => `${g} ${n}`).join(", ") + ".",
  });

  // Rooms and day are a property of the subgroup. Engineering's .3 subgroups really do
  // split 11/2 between drawing rooms (CSV_PIPELINE.md §4.2), so this is information for
  // checking against the source, not an error.
  const bySub = new Map<string, RosterRow[]>();
  for (const r of rows) if (r.subgroup) bySub.set(r.subgroup, [...(bySub.get(r.subgroup) ?? []), r]);
  for (const [sub, members] of [...bySub].sort()) {
    for (const f of ["day", "workshop", "drawing"] as const) {
      const values = new Map<string, number>();
      for (const r of members) values.set(r[f] ?? "—", (values.get(r[f] ?? "—") ?? 0) + 1);
      if (values.size > 1) {
        out.push({
          level: "info",
          message: `${sub} ${f}: ${[...values].map(([v, n]) => `${n} ${v}`).join(", ")}. Check against the source.`,
        });
      }
    }
  }

  return out;
}
