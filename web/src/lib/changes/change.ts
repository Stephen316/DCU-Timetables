// A change to a course's timetable: a class removed or added, for everyone on the course
// or one group of it (supabase/phase17_timetable_changes.sql).
//
// No `server-only`: the Timetable page's forms run the same checks in the browser that
// saving runs on the server.

import type { Finding } from "@/lib/extraction/rotation";
import { programmeFor } from "@/lib/proposals/courses";

export type TimetableChange = {
  courseKey: string;
  /// "C", "C.2", or null for everyone on the course.
  group: string | null;
  kind: "remove" | "add";
  module: string;
  /// Remove only: one DCU activity (EEG1001[1]OC/P2/01) where two classes of the module
  /// start together. Null hides every class of the module at that time.
  activityCode: string | null;
  /// Add only: what the class is — Lab, Tutorial, Make-up lab.
  title: string | null;
  dates: string[];
  start: string;
  end: string | null;
  room: string | null;
  note: string | null;
};

export type SavedChange = TimetableChange & { id: string; createdAt: string };

const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const GROUP = /^[A-Z](\.[0-9]{1,2})?$/;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function weekday(date: string): string {
  return DAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
}

/// The same rules the table enforces, said in words before the database says them in codes.
export function checkChange(c: TimetableChange): Finding[] {
  const out: Finding[] = [];
  const err = (message: string) => out.push({ level: "error", message });
  const programme = programmeFor(c.courseKey);

  if (!programme) err("Pick the programme this change is for.");
  if (!c.module) err("No module.");
  else if (!/^[A-Z]{2,6}[0-9]{3,5}$/.test(c.module)) err(`"${c.module}" isn't a module code.`);
  else if (programme && !programme.modules.some((m) => m.code === c.module)) {
    // DCU shares some classes between modules — CHM1006's lectures sit on EEG1017's
    // timetable — and the phone knows them by the first module's code. So removing one is
    // allowed; it just isn't one of the programme's own.
    out.push({ level: "warn", message: `${c.module} isn't one of ${programme.key}'s modules — DCU lists it here as a shared class.` });
  }
  if (c.group && !GROUP.test(c.group)) err(`"${c.group}" isn't a group — a letter, or a letter and a number like C.2.`);
  if (!TIME.test(c.start)) err(`"${c.start}" isn't a start time. Use 24-hour, like 14:00.`);
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

/// What a phone does with a removal, done against DCU's timetable here: which of the dates
/// have a class for it to hide. A removal that hides nothing is a wrong date or time.
export function removalHits(c: TimetableChange, classes: { module: string; code: string; date: string; start: string }[]) {
  const hits = (date: string) => classes.filter((x) =>
    x.module === c.module && x.date === date && x.start === c.start && (!c.activityCode || x.code === c.activityCode));
  return c.dates.map((date) => ({ date, codes: hits(date).map((x) => x.code) }));
}

export function hitFindings(c: TimetableChange, hits: ReturnType<typeof removalHits>): Finding[] {
  if (c.kind !== "remove") return [];
  const none = hits.filter((h) => h.codes.length === 0).map((h) => h.date);
  const out: Finding[] = [];
  if (none.length) {
    out.push({
      level: none.length === hits.length ? "error" : "warn",
      message: `No ${c.module} class starts at ${c.start} on ${none.map((d) => `${weekday(d)} ${d}`).join(", ")} — nothing to remove there.`,
    });
  }
  const several = hits.filter((h) => h.codes.length > 1);
  if (several.length && !c.activityCode) {
    out.push({
      level: "warn",
      message: `${several.length === 1 ? "One date has" : `${several.length} dates have`} more than one ${c.module} class at ${c.start} (${[...new Set(several.flatMap((h) => h.codes))].join(", ")}); all of them are removed.`,
    });
  }
  return out;
}

export function toRow(c: TimetableChange) {
  return {
    course_key: c.courseKey, grp: c.group, kind: c.kind, module: c.module,
    activity_code: c.kind === "remove" ? c.activityCode : null,
    title: c.kind === "add" ? c.title : null,
    dates: [...new Set(c.dates)].sort(), start_time: c.start,
    end_time: c.kind === "add" ? c.end : null,
    room: c.kind === "add" ? c.room : null, note: c.note,
  };
}

export function fromRow(r: Record<string, any>): SavedChange {
  return {
    id: r.id, createdAt: r.created_at, courseKey: r.course_key, group: r.grp, kind: r.kind,
    module: r.module, activityCode: r.activity_code, title: r.title, dates: r.dates ?? [],
    start: r.start_time, end: r.end_time, room: r.room, note: r.note,
  };
}

export function describeChange(c: TimetableChange): string {
  const who = c.group ? `group ${c.group}` : "everyone";
  const what = c.kind === "remove"
    ? `Remove ${c.activityCode ?? c.module} at ${c.start}`
    : `Add ${c.module} ${c.title ?? ""} ${c.start}–${c.end ?? "?"}${c.room ? ` in ${c.room}` : ""}`;
  return `${what} · ${who} · ${c.dates.length} date${c.dates.length === 1 ? "" : "s"}`;
}

/// An added class's hours and room must come from what the administrator said, not from the
/// model: nothing downstream can check an invented 10:00 against anything. A removal's
/// time is checked against DCU's timetable instead (`removalHits`).
export function checkChangeProvenance(c: TimetableChange, source: string): Finding[] {
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
