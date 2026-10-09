// A change to a course's timetable: a class removed, added, or moved to another room or
// lecturer, for everyone on the course or one group of it — a lab group, a subgroup, or one
// of the programmes the course covers (supabase/phase17_timetable_changes.sql,
// phase19_programme_groups.sql, phase30_class_edits.sql).
//
// No `server-only`: the Timetable page's forms run the same checks in the browser that
// saving runs on the server.

import type { Finding } from "@/lib/extraction/rotation";
import { PROGRAMME_CODE, programmeFor, type Programme } from "@/lib/proposals/courses";

export type TimetableChange = {
  courseKey: string;
  /// "C", "C.2", a programme ("BMED1"), or null for everyone on the course.
  group: string | null;
  /// An edit finds its class as a removal does, and gives it `room` and/or `staff`.
  kind: "remove" | "add" | "edit";
  module: string;
  /// Remove or edit: one DCU activity (EEG1001[1]OC/P2/01) where two classes of the module
  /// start together. Null means every class of the module at that time.
  activityCode: string | null;
  /// Add only: what the class is — Lab, Tutorial, Make-up lab.
  title: string | null;
  dates: string[];
  start: string;
  end: string | null;
  /// An added class's room, or an edited class's new one. Null leaves an edit's room as DCU has it.
  room: string | null;
  /// The lecturer, as a person reads it: an added class's, or an edited class's new one.
  staff: string | null;
  note: string | null;
};

export type SavedChange = TimetableChange & { id: string; createdAt: string };

const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LAB_GROUP = /^[A-Z](\.[0-9]{1,2})?$/;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function weekday(date: string): string {
  return DAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
}

/// The same rules the table enforces, said in words before the database says them in codes.
export function checkChange(c: TimetableChange, programme: Programme | undefined = programmeFor(c.courseKey)): Finding[] {
  const out: Finding[] = [];
  const err = (message: string) => out.push({ level: "error", message });

  if (!programme) err("Pick the programme this change is for.");
  if (!c.module) err("No module.");
  else if (!/^[A-Z]{2,6}[0-9]{3,5}$/.test(c.module)) err(`"${c.module}" isn't a module code.`);
  else if (programme && !programme.modules.some((m) => m.code === c.module)) {
    // DCU shares some classes between modules — CHM1006's lectures sit on EEG1017's
    // timetable — and the phone knows them by the first module's code. So removing one is
    // allowed; it just isn't one of the programme's own.
    out.push({ level: "warn", message: `${c.module} isn't one of ${programme.key}'s modules — DCU lists it here as a shared class.` });
  }
  if (c.group) {
    const g = groupProblem(c.group, programme);
    if (g) err(g);
  }
  if (!TIME.test(c.start)) err(`"${c.start}" isn't a start time. Use 24-hour, like 14:00.`);
  if (c.kind === "edit" && !c.room?.trim() && !c.staff?.trim()) err("Give a new room or a new lecturer.");
  if (c.room && c.room.trim().length > 80) err("The room is over 80 characters.");
  if (c.staff && c.staff.trim().length > 120) err("The lecturer is over 120 characters.");
  if (c.kind === "add") {
    if (!c.title?.trim()) err("Say what the class is — Lab, Tutorial…");
    if (!c.end || !TIME.test(c.end)) err("An added class needs an end time.");
    else if (TIME.test(c.start) && c.end <= c.start) err(`It ends (${c.end}) before it starts (${c.start}).`);
  }
  if (c.dates.length === 0) err("No dates.");
  if (c.dates.length > 60) err(`${c.dates.length} dates — the limit is 60.`);
  const bad = c.dates.filter((d) => !DATE.test(d) || Number.isNaN(Date.parse(`${d}T12:00:00Z`)));
  if (bad.length) err(`Not dates: ${bad.join(", ")}.`);
  const weekend = c.dates.filter((d) => DATE.test(d) && ["Sat", "Sun"].includes(weekday(d)));
  if (weekend.length) out.push({ level: "warn", message: `On a weekend: ${weekend.join(", ")}.` });
  return out;
}

/// What a phone does with a removal or an edit, done against DCU's timetable here: which of
/// the dates have a class for it to hide or change. One that finds nothing is a wrong date or time.
export function removalHits(c: TimetableChange, classes: { module: string; code: string; date: string; start: string }[]) {
  const hits = (date: string) => classes.filter((x) =>
    x.module === c.module && x.date === date && x.start === c.start && (!c.activityCode || x.code === c.activityCode));
  return c.dates.map((date) => ({ date, codes: hits(date).map((x) => x.code) }));
}

export function hitFindings(c: TimetableChange, hits: ReturnType<typeof removalHits>): Finding[] {
  if (c.kind === "add") return [];
  const verb = c.kind === "edit" ? "change" : "remove";
  const none = hits.filter((h) => h.codes.length === 0).map((h) => h.date);
  const out: Finding[] = [];
  if (none.length) {
    out.push({
      level: none.length === hits.length ? "error" : "warn",
      message: `No ${c.module} class starts at ${c.start} on ${none.map((d) => `${weekday(d)} ${d}`).join(", ")} — nothing to ${verb} there.`,
    });
  }
  const several = hits.filter((h) => h.codes.length > 1);
  if (several.length && !c.activityCode) {
    out.push({
      level: "warn",
      message: `${several.length === 1 ? "One date has" : `${several.length} dates have`} more than one ${c.module} class at ${c.start} (${[...new Set(several.flatMap((h) => h.codes))].join(", ")}); all of them are ${c.kind === "edit" ? "changed" : "removed"}.`,
    });
  }
  return out;
}

export function toRow(c: TimetableChange) {
  return {
    course_key: c.courseKey, grp: c.group, kind: c.kind, module: c.module,
    activity_code: c.kind !== "add" ? c.activityCode : null,
    title: c.kind === "add" ? c.title : null,
    dates: [...new Set(c.dates)].sort(), start_time: c.start,
    end_time: c.kind === "add" ? c.end : null,
    room: c.kind !== "remove" ? c.room : null,
    staff: c.kind !== "remove" ? c.staff : null,
    note: c.note,
  };
}

export function fromRow(r: Record<string, any>): SavedChange {
  return {
    id: r.id, createdAt: r.created_at, courseKey: r.course_key, group: r.grp, kind: r.kind,
    module: r.module, activityCode: r.activity_code, title: r.title, dates: r.dates ?? [],
    start: r.start_time, end: r.end_time, room: r.room, staff: r.staff ?? null, note: r.note,
  };
}

/// Who a change is for, in words: "everyone", "group C", "BMED1".
export function audience(group: string | null): string {
  return !group ? "everyone" : PROGRAMME_CODE.test(group) ? group : `group ${group}`;
}

/// Why this isn't a group the course has, or null when it is. A programme must be one the
/// course covers: "ECE2" would be saved and then match no student.
export function groupProblem(group: string, programme: Programme | undefined): string | null {
  if (LAB_GROUP.test(group)) return null;
  if (PROGRAMME_CODE.test(group)) {
    if (!programme || programme.covers.some((c) => c.code === group)) return null;
    if (!programme.covers.length) return `${programme.key} has no programmes within it to make a change for.`;
    return `${group} isn't one of ${programme.key}'s programmes (${programme.covers.map((c) => c.code).join(", ")}).`;
  }
  return `"${group}" isn't a group — a letter, a letter and a number like C.2, or a programme like BMED1.`;
}

/// "CE1, ECE1 ME1" → ["CE1", "ECE1", "ME1"]; blank → [null], everyone.
export function groupList(text: string): (string | null)[] {
  const list = [...new Set(text.toUpperCase().split(/[\s,;]+/).filter(Boolean))];
  return list.length ? list : [null];
}

/// `who` names several groups at once, for a change Ask proposes for more than one.
export function describeChange(c: Omit<TimetableChange, "group"> & { group?: string | null }, who = audience(c.group ?? null)): string {
  const what = c.kind === "remove" ? `Remove ${c.activityCode ?? c.module} at ${c.start}`
    : c.kind === "edit" ? `Change ${c.activityCode ?? c.module} at ${c.start}: ${edited(c)}`
    : `Add ${c.module} ${c.title ?? ""} ${c.start}–${c.end ?? "?"}${c.room ? ` in ${c.room}` : ""}${c.staff ? ` with ${c.staff}` : ""}`;
  return `${what} · ${who} · ${c.dates.length} date${c.dates.length === 1 ? "" : "s"}`;
}

/// What an edit changes, in words: "room GLA.S210, lecturer Dr Smith".
export function edited(c: { room: string | null; staff: string | null }): string {
  return [c.room && `room ${c.room}`, c.staff && `lecturer ${c.staff}`].filter(Boolean).join(", ");
}

/// An added class's hours and room must come from what the administrator said, not from the
/// model: nothing downstream can check an invented 10:00 against anything. A removal's
/// time is checked against DCU's timetable instead (`removalHits`).
export function checkChangeProvenance(c: Omit<TimetableChange, "group">, source: string): Finding[] {
  if (c.kind !== "add") return [];
  const text = source.toLowerCase();
  const mentions = (n: number) => new RegExp(`(?<!\\d)${n}(?!\\d)`).test(text);
  const hourSaid = (hhmm: string | null) => {
    const h = Number(hhmm?.split(":")[0]);
    return Number.isFinite(h) && (mentions(h) || mentions(h % 12 === 0 ? 12 : h % 12));
  };
  const unsaid: string[] = [];
  if (c.start && !hourSaid(c.start)) unsaid.push(`start ${c.start}`);
  if (c.end && !hourSaid(c.end)) unsaid.push(`end ${c.end}`);
  if (c.room && !text.replace(/\s+/g, "").includes(c.room.toLowerCase().replace(/\s+/g, ""))) unsaid.push(`room ${c.room}`);
  return unsaid.length
    ? [{ level: "error", message: `${unsaid.join(", ")} ${unsaid.length > 1 ? "appear" : "appears"} nowhere in what you wrote, so it was assumed. Say it explicitly if it is right.` }]
    : [];
}

/// Who a change from Ask is for, checked against what the administrator said. A programme it
/// is for, or kept for, must have been named: by its code ("CE1"), its CAO code, or a word of
/// its name no other programme of the course shares ("Biomedical", "Mechatronics"). Lab
/// groups aren't checked — a lone "C" is in every sentence. No programme can both keep the
/// class and lose it. And a change for everyone can't come from a request that named
/// programmes: "remove the 11:00 for BMED1 and CAM1" came back from mistral-small with no
/// groups at all (8 Oct 2026), which would have removed it for all six.
///
/// When the class is kept for some programmes, either side may have been the one named:
/// "only CE1 has the 10:00" names who keeps it, "everyone else has the 11:00" names who
/// loses it (CE1), and the model lists the other five as keeping it.
export function checkAudienceProvenance(
  groups: (string | null)[], keptFor: string[], programme: Programme | undefined, source: string,
): Finding[] {
  const out: Finding[] = [];
  const both = keptFor.filter((g) => groups.includes(g));
  if (both.length) out.push({ level: "error", message: `${both.join(", ")} would both keep the class and lose it.` });

  const mentioned = programmesNamed(programme, source);
  // A code that isn't one of the course's is groupProblem's to report.
  const named = (code: string) => mentioned.includes(code) || !programme?.covers.some((c) => c.code === code);
  if (!keptFor.length && groups.includes(null)) {
    if (mentioned.length) {
      out.push({
        level: "error",
        message: `You named ${mentioned.join(", ")}, but this is for everyone on ${programme!.key}. Say which programmes lose the class, or which keep it.`,
      });
    }
  }
  const losing = groups.filter((g): g is string => !!g && PROGRAMME_CODE.test(g));
  const unsaid = !keptFor.length ? losing.filter((code) => !named(code))
    : keptFor.every(named) || (losing.length > 0 && losing.every(named)) ? []
    : keptFor.filter((code) => !named(code));
  if (unsaid.length) {
    out.push({
      level: "error",
      message: `${unsaid.join(", ")} ${unsaid.length > 1 ? "appear" : "appears"} nowhere in what you wrote, so ${unsaid.length > 1 ? "they were" : "it was"} assumed. Name the programmes if ${unsaid.length > 1 ? "they are" : "it is"} right.`,
    });
  }
  return out;
}

/// The course's programmes a text names: by code ("CE1"), CAO code, or a word of the name
/// no other programme of the course shares ("Biomedical", "Mechatronics" — not "Mechanical",
/// which two of them have).
export function programmesNamed(programme: Programme | undefined, source: string): string[] {
  const covers = programme?.covers ?? [];
  const text = source.toLowerCase();
  const words = (name: string) => name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 5 && w !== "engineering");
  return covers.filter((p) => {
    const own = words(p.name).filter((w) => !covers.some((o) => o !== p && words(o.name).includes(w)));
    return new RegExp(`(?<![a-z0-9])${p.code.toLowerCase()}(?![a-z0-9])`).test(text) ||
      text.includes(p.cao.toLowerCase()) || own.some((w) => text.includes(w));
  }).map((p) => p.code);
}
