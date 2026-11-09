// A schedule of one-off events for teams — "A1.a, 11/11/2026, 2pm, S378" — read from whatever
// a document gives.
//
// The model only transcribes: each row's team, date, time and room exactly as written.
// Everything that decides something is here, in code — which day-and-month order the dates
// use, what "2.15pm" is, how long a slot lasts when the document gives no end time — and every
// value the model returned is checked against the document's own text, because nothing
// downstream can tell an invented 2pm from a real one.
//
// Not `server-only`: pure, and exercised with tsx.

import type { Finding } from "@/lib/extraction/rotation";

/// One row as the model transcribed it. Every field is the document's own text.
export type RawEvent = {
  who: string | null;
  date: string | null;
  time: string | null;
  end_time: string | null;
  room: string | null;
};

export type ScheduleEvent = {
  /** 1-based position among the rows read, so a finding can point at it. */
  row: number;
  /** The team or group as the document writes it: "A1.a". */
  team: string;
  date: string | null;
  start: string | null;
  end: string | null;
  room: string | null;
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const pad = (n: number) => String(n).padStart(2, "0");

function validDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const t = new Date(Date.UTC(y, m - 1, d, 12));
  return t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
}

const SLASHED = /^\s*(?:[A-Za-z]{3,9}\.?,?\s+)?(\d{1,2})\s*[/.\-]\s*(\d{1,2})\s*[/.\-]\s*(\d{2}|\d{4})\s*$/;

/// Whether numeric dates in this document read day first. A date with a first part over 12
/// can only be day first, one with a second part over 12 only month first; a document where
/// every date is ambiguous is read day first, as Irish ones are.
export function dayFirst(dates: (string | null)[]): { dayFirst: boolean; ambiguous: boolean; numeric: number } {
  let day = 0, month = 0, numeric = 0;
  for (const raw of dates) {
    const m = raw?.match(SLASHED);
    if (!m) continue;
    numeric++;
    if (Number(m[1]) > 12) day++;
    if (Number(m[2]) > 12) month++;
  }
  return { dayFirst: !(month > 0 && day === 0), ambiguous: numeric > 0 && day === 0 && month === 0, numeric };
}

/// "11/11/2026", "11 Nov 2026", "Wed 11 November 2026" or "2026-11-11" -> "2026-11-11".
export function parseDate(raw: string | null, dayFirstOrder = true): string | null {
  if (!raw) return null;
  const t = raw.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = t.match(SLASHED);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return dayFirstOrder ? validDate(y, b, a) : validDate(y, a, b);
  }
  m = t.match(/^(?:[A-Za-z]{3,9}\.?,?\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{2}|\d{4})$/);
  if (m) {
    const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return mo ? validDate(y, mo, Number(m[1])) : null;
  }
  return null;
}

/// "2pm", "2.15pm", "11.15am", "2:30 PM", "14:00" -> "14:00". A time with no am or pm and an
/// hour of 1 to 7 is taken as the afternoon (nothing is taught at 2am), and reported through
/// `assumed` so the administrator is told it was a guess.
export function parseTime(raw: string | null, assumed?: { count: number }): string | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  let m = t.match(/^(\d{1,2})(?:\s*[:.h]\s*(\d{2}))?\s*([ap])\.?\s*m?\.?$/);
  if (m) {
    let h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    if (h < 1 || h > 12 || min > 59) return null;
    if (m[3] === "p" && h !== 12) h += 12;
    if (m[3] === "a" && h === 12) h = 0;
    return `${pad(h)}:${pad(min)}`;
  }
  m = t.match(/^(\d{1,2})\s*[:.h]\s*(\d{2})$/);
  if (m) {
    let h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    if (h >= 1 && h <= 7) { h += 12; if (assumed) assumed.count++; }
    return `${pad(h)}:${pad(min)}`;
  }
  return null;
}

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const clock = (n: number) => `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;

/// The usual gap between one team's start and the next in the same room on the same day —
/// what a slot lasts when the document gives no end time. Null when no two slots share a room
/// and day, or the commonest gap is implausible for a slot.
export function slotLength(events: { date: string | null; start: string | null; room: string | null }[]): number | null {
  const byPlace = new Map<string, number[]>();
  for (const e of events) {
    if (!e.date || !e.start) continue;
    const k = `${e.date}|${e.room ?? ""}`;
    byPlace.set(k, [...(byPlace.get(k) ?? []), minutes(e.start)]);
  }
  const gaps = new Map<number, number>();
  for (const starts of byPlace.values()) {
    const sorted = [...new Set(starts)].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) gaps.set(sorted[i] - sorted[i - 1], (gaps.get(sorted[i] - sorted[i - 1]) ?? 0) + 1);
  }
  const best = [...gaps].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  return best && best[0] >= 5 && best[0] <= 180 ? best[0] : null;
}

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, "");

/// A value the model returned must be in the text it was given. Compared without spaces or
/// case, so "2.15pm" matches "2.15 pm".
function inSource(value: string | null, source: string): boolean {
  return !value || squash(source).includes(squash(value));
}

const summarise = (rows: number[], limit = 6) =>
  rows.length <= limit ? rows.join(", ") : `${rows.slice(0, limit).join(", ")} and ${rows.length - limit} more`;

export function readSchedule(raw: RawEvent[], source: string): { events: ScheduleEvent[]; findings: Finding[] } {
  const findings: Finding[] = [];
  const order = dayFirst(raw.map((r) => r.date));
  const assumed = { count: 0 };

  const parsed = raw.map((r, i) => ({
    row: i + 1,
    r,
    team: r.who?.trim().replace(/^team\s+/i, "") || null,
    date: parseDate(r.date, order.dayFirst),
    start: parseTime(r.time, assumed),
    end: parseTime(r.end_time, assumed),
  }));

  const noTeam = parsed.filter((p) => !p.team).map((p) => p.row);
  const noDate = parsed.filter((p) => !p.date).map((p) => p.row);
  const noTime = parsed.filter((p) => !p.start).map((p) => p.row);
  if (noTeam.length) findings.push({ level: "error", message: `No team or group on rows ${summarise(noTeam)}.` });
  if (noDate.length) findings.push({ level: "error", message: `Couldn't read the date on rows ${summarise(noDate)}.` });
  if (noTime.length) findings.push({ level: "error", message: `Couldn't read the start time on rows ${summarise(noTime)}.` });

  // Nothing here may be the model's invention: the date, the time and the room must each be
  // in the document's text, as written.
  const unsaid = parsed.filter((p) =>
    !inSource(p.r.who, source) || !inSource(p.r.date, source) || !inSource(p.r.time, source) ||
    !inSource(p.r.end_time, source) || !inSource(p.r.room, source)).map((p) => p.row);
  if (unsaid.length) {
    findings.push({ level: "error", message: `Rows ${summarise(unsaid)} have a value that is not in the document, so it was assumed.` });
  }

  if (order.numeric) {
    findings.push({
      level: "info",
      message: order.dayFirst
        ? `Dates read day first${order.ambiguous ? " (every date could be read either way)" : ""}: ${parsed.find((p) => p.date)?.r.date ?? ""} is ${parsed.find((p) => p.date)?.date ?? ""}.`
        : "Dates read month first.",
    });
  }
  if (assumed.count) {
    findings.push({ level: "warn", message: `${assumed.count} time${assumed.count === 1 ? " has" : "s have"} no am or pm, so an hour from 1 to 7 was taken as the afternoon.` });
  }

  const slot = slotLength(parsed.map((p) => ({ date: p.date, start: p.start, room: p.r.room?.trim() || null })));
  const missingEnd = parsed.filter((p) => p.start && !p.end);
  if (missingEnd.length && slot === null) {
    findings.push({ level: "error", message: "The document gives no end times and the slots don't share a room and day, so how long each lasts can't be worked out." });
  } else if (missingEnd.length) {
    findings.push({
      level: "warn",
      message: `The document gives no end time${missingEnd.length === parsed.length ? "s" : ` on ${missingEnd.length} rows`}, so each slot is taken to last ${slot} minutes — the gap between one team and the next.`,
    });
  }

  const events: ScheduleEvent[] = parsed.map((p) => {
    let end = p.end;
    if (!end && p.start && slot !== null) {
      const e = minutes(p.start) + slot;
      end = e < 24 * 60 ? clock(e) : null;
    }
    return { row: p.row, team: p.team ?? "", date: p.date, start: p.start, end, room: p.r.room?.trim() || null };
  });

  const noEnd = events.filter((e) => e.start && !e.end).map((e) => e.row);
  if (noEnd.length && slot !== null) findings.push({ level: "error", message: `Rows ${summarise(noEnd)} would end after midnight.` });
  const backwards = events.filter((e) => e.start && e.end && e.end <= e.start).map((e) => e.row);
  if (backwards.length) findings.push({ level: "error", message: `Rows ${summarise(backwards)} end before they start.` });

  const seen = new Map<string, number[]>();
  for (const e of events) if (e.team) seen.set(e.team.toUpperCase(), [...(seen.get(e.team.toUpperCase()) ?? []), e.row]);
  const repeats = [...seen].filter(([, rows]) => rows.length > 1);
  if (repeats.length) {
    findings.push({
      level: "warn",
      message: `${repeats.length === 1 ? "A team has" : `${repeats.length} teams have`} more than one slot: ` +
        repeats.slice(0, 6).map(([t, rows]) => `${t} (rows ${rows.join(", ")})`).join("; ") + ".",
    });
  }
  const clash = new Map<string, number[]>();
  for (const e of events) if (e.date && e.start && e.room) clash.set(`${e.date}|${e.start}|${e.room}`, [...(clash.get(`${e.date}|${e.start}|${e.room}`) ?? []), e.row]);
  const doubled = [...clash.values()].filter((rows) => rows.length > 1);
  if (doubled.length) findings.push({ level: "warn", message: `${doubled.length} slot${doubled.length === 1 ? " is" : "s are"} used by two teams in the same room (rows ${doubled.slice(0, 4).map((r) => r.join(" and ")).join("; ")}).` });

  return { events, findings };
}

/// Against the class list's teams: one that isn't on it would be saved and shown to nobody,
/// and a team on it with no slot is likelier a missing row than a team with nothing to do.
export function checkTeams(events: ScheduleEvent[], known: Set<string> | null): Finding[] {
  if (known === null) return [];
  if (known.size === 0) {
    return [{ level: "error", message: "The class list has no teams, so these slots would reach nobody. Add the teams to the class list first." }];
  }
  const out: Finding[] = [];
  const upper = (t: string) => t.trim().replace(/\s+/g, "").toUpperCase();
  const unknown = [...new Set(events.filter((e) => e.team && !known.has(upper(e.team))).map((e) => e.team))];
  if (unknown.length) {
    out.push({ level: "error", message: `Not on the class list as teams, so no student would see them: ${unknown.slice(0, 10).join(", ")}${unknown.length > 10 ? ` and ${unknown.length - 10} more` : ""}.` });
  }
  const given = new Set(events.map((e) => upper(e.team)));
  const without = [...known].filter((t) => !given.has(t)).sort();
  if (without.length) {
    out.push({ level: "info", message: `${without.length} team${without.length === 1 ? "" : "s"} on the class list ${without.length === 1 ? "has" : "have"} no slot here: ${without.slice(0, 10).join(", ")}${without.length > 10 ? " …" : ""}.` });
  }
  return out;
}
