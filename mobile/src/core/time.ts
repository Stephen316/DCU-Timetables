/**
 * Calendar arithmetic on the device's own clock, and Irish clock time.
 *
 * Everything here is written against plain `Date` rather than a date library: the rules
 * the app needs are few (start of day, whole-day steps, Monday-first weeks) and each one is
 * tested. Whole-day steps go through the `Date(y, m, d)` constructor rather than adding
 * 24 hours, so a step across a clock change still lands on midnight.
 */

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** The same wall-clock time `days` calendar days away. */
export function addDays(date: Date, days: number): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + days,
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds(),
  );
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MINUTE);
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Whole calendar days from `from`'s midnight to `to`'s. Rounded because a day that
 * contains a clock change is 23 or 25 hours long.
 */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY);
}

/** 0 = Monday … 6 = Sunday. */
export function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/** Monday 00:00 of the week `date` falls in. Weeks here always run Monday to Sunday. */
export function startOfWeek(date: Date): Date {
  return addDays(startOfDay(date), -mondayIndex(date));
}

export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

export function isToday(date: Date, now: Date = new Date()): boolean {
  return isSameDay(date, now);
}

export function isTomorrow(date: Date, now: Date = new Date()): boolean {
  return isSameDay(date, addDays(startOfDay(now), 1));
}

// MARK: - Wording

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const pad = (n: number) => String(n).padStart(2, '0');

/** "14:05" — Irish convention, 24-hour. */
export function formatTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function weekdayName(date: Date): string {
  return WEEKDAYS[date.getDay()];
}

export function weekdayShort(date: Date): string {
  return WEEKDAYS[date.getDay()].slice(0, 3);
}

export function monthName(date: Date): string {
  return MONTHS[date.getMonth()];
}

/** "17 September" */
export function formatDayMonth(date: Date): string {
  return `${date.getDate()} ${monthName(date)}`;
}

/** "Thursday 17 September" */
export function formatWeekdayDayMonth(date: Date): string {
  return `${weekdayName(date)} ${formatDayMonth(date)}`;
}

/** "Thursday 17 Sep, 14:00" */
export function formatWeekdayDayMonthTime(date: Date): string {
  return `${weekdayName(date)} ${date.getDate()} ${monthName(date).slice(0, 3)}, ${formatTime(date)}`;
}

/** "17 Sep 2026, 14:00" */
export function formatAbbreviated(date: Date): string {
  return `${date.getDate()} ${monthName(date).slice(0, 3)} ${date.getFullYear()}, ${formatTime(date)}`;
}

/** "Thursday 17 September 2026 at 14:00" */
export function formatComplete(date: Date): string {
  return `${formatWeekdayDayMonth(date)} ${date.getFullYear()} at ${formatTime(date)}`;
}

/** "yyyy-MM-dd" on the device's clock. */
export function localDateString(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// MARK: - ISO 8601

/** "2026-09-16T09:00:00Z" — whole seconds, UTC. */
export function isoSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Reads the timestamps Supabase and the DCU API send: "2026-09-15T13:30:00+00:00",
 * "…:00Z", or with a fraction of any length ("…:00.123456+00:00"), which not every
 * engine's `Date.parse` accepts. Null when the text isn't one.
 */
export function parseISO(text: string | null | undefined): Date | null {
  if (typeof text !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(text.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s = '0', frac = '', zone = 'Z'] = m;
  const ms = Number((frac + '000').slice(0, 3));
  let offset = 0;
  if (zone !== 'Z') {
    const sign = zone[0] === '-' ? -1 : 1;
    const digits = zone.slice(1).replace(':', '');
    offset = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
  }
  const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), ms);
  return new Date(utc - offset * MINUTE);
}

// MARK: - Irish time

/**
 * Irish clock time. Everything the console writes — rotation sessions, changes — is in it,
 * while DCU's own events arrive as true UTC.
 *
 * Worked out from the EU rule rather than a time-zone database: Irish Summer Time (UTC+1)
 * runs from 01:00 UTC on the last Sunday of March to 01:00 UTC on the last Sunday of
 * October, and GMT the rest of the year. The rule has held since 1996, so the answer is the
 * same on every phone whatever its JavaScript engine ships.
 */
export const DublinTime = {
  /** Minutes Dublin is ahead of UTC at this instant. */
  offsetMinutes(instant: Date): number {
    const year = instant.getUTCFullYear();
    const start = lastSundayUTC(year, 2);
    const end = lastSundayUTC(year, 9);
    const t = instant.getTime();
    return t >= start && t < end ? 60 : 0;
  },

  /** "yyyy-MM-dd" as a clock in Dublin reads it. */
  dateString(instant: Date): string {
    const shifted = new Date(instant.getTime() + DublinTime.offsetMinutes(instant) * MINUTE);
    return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
  },

  /** "HH:mm" as a clock in Dublin reads it. */
  timeString(instant: Date): string {
    const shifted = new Date(instant.getTime() + DublinTime.offsetMinutes(instant) * MINUTE);
    return `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
  },

  /** "2026-10-14" at "14:00", Dublin time. Null when either string isn't one. */
  date(dateString: string, time: string): Date | null {
    const d = dateString.split('-').map(Number);
    const t = time.split(':').map(Number);
    if (d.length !== 3 || t.length !== 2 || [...d, ...t].some((n) => !Number.isInteger(n))) {
      return null;
    }
    const wall = Date.UTC(d[0], d[1] - 1, d[2], t[0], t[1]);
    // The offset depends on the instant, which is what's being found. Guess with the
    // offset at the wall time read as UTC, then correct once if the guess landed on the
    // other side of a clock change.
    let instant = wall - DublinTime.offsetMinutes(new Date(wall)) * MINUTE;
    const settled = wall - DublinTime.offsetMinutes(new Date(instant)) * MINUTE;
    if (settled !== instant) instant = settled;
    return new Date(instant);
  },
};

/** 01:00 UTC on the last Sunday of `month` (0-based). */
function lastSundayUTC(year: number, month: number): number {
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  const sunday = lastDay.getUTCDate() - lastDay.getUTCDay();
  return Date.UTC(year, month, sunday, 1);
}
