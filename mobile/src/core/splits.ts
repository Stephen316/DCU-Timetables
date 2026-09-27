import { kindLabel } from './activityCode';
import { DublinTime } from './time';
import { moduleCodeOf, TimetableEvent } from './timetableEvent';

/**
 * "Surnames A–M have the lecture Tuesday at 10, N–Z Thursday at 2." DCU publishes both
 * sessions to everyone on the module; a split saved in the console says which one is this
 * student's, and the other is hidden. Saved from Ask (supabase/phase9_module_splits.sql).
 *
 * No personal data travels: the rule is public, and it is matched here against the surname
 * the app already has from the student's own address.
 */
export interface ModuleSplit {
  /** "EEG1001" */
  module: string;
  /** What the console calls the session: "Lecture", "Tutorial", "Lab", "Workshop". */
  activity: string;
  bands: SplitBand[];
}

export interface SplitBand {
  /** Single letters, inclusive at both ends: A–M means every surname starting A to M. */
  from: string;
  to: string;
  /** "Tue" */
  day: string;
  /** "10:00", Dublin time */
  start: string;
  end: string;
  /** Where this band goes, when the console says. */
  room: string | null;
  label: string | null;
}

/** Reads a `module_splits` row with its `module_split_ranges` embedded. Null when it isn't one. */
export function splitFromRow(row: Record<string, unknown>): ModuleSplit | null {
  if (typeof row.module_key !== 'string' || typeof row.activity !== 'string' || !Array.isArray(row.module_split_ranges)) {
    return null;
  }
  const text = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
  const bands: SplitBand[] = [];
  for (const raw of row.module_split_ranges as Record<string, unknown>[]) {
    const from = text(raw?.from_letter)?.toUpperCase();
    const to = text(raw?.to_letter)?.toUpperCase();
    const day = text(raw?.day);
    const start = clock(text(raw?.start_time));
    const end = clock(text(raw?.end_time));
    // A band missing any of these can't be placed, and guessing it would hide a real class.
    if (!from || !to || !day || !start || !end) return null;
    bands.push({ from, to, day, start, end, room: text(raw.room), label: text(raw.label) });
  }
  if (bands.length === 0) return null;
  bands.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  return { module: row.module_key, activity: row.activity, bands };
}

/** "9:00" and "09:00" are the same time; the timetable writes the second. */
function clock(time: string | null): string | null {
  const m = time?.match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

/**
 * The letter a split sorts a surname by: its first, A–Z. Null when there isn't one — an
 * address with no surname in it — and then no split applies, because hiding a class on a
 * guess is worse than showing one too many.
 */
export function surnameInitial(familyName: string | null | undefined): string | null {
  const first = (familyName ?? '').trim().charAt(0).toUpperCase();
  return /^[A-Z]$/.test(first) ? first : null;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const ModuleSplits = {
  /** The student's band, or null when their initial falls in none of them. */
  bandFor(split: ModuleSplit, initial: string): SplitBand | null {
    return split.bands.find((b) => b.from <= initial && initial <= b.to) ?? null;
  },

  /**
   * A week's events with each split applied: a session that belongs to another band is
   * hidden, and the student's own takes its band's room when the console gave one.
   *
   * A session is governed by a split when its module and kind match and it starts on a
   * band's day and time. Anything else is left alone — another kind of class, a slot no band
   * names, or a student whose initial is unknown or in no band. The rule can only take away
   * sessions it can place; it never takes one on a guess.
   */
  apply(events: TimetableEvent[], splits: ModuleSplit[], initial: string | null): TimetableEvent[] {
    if (initial === null || splits.length === 0) return events;
    return events.flatMap((event) => {
      const split = splits.find((s) => s.module === moduleCodeOf(event) && sameActivity(s.activity, event));
      if (!split) return [event];
      const mine = ModuleSplits.bandFor(split, initial);
      if (!mine) return [event];

      const day = WEEKDAYS[new Date(`${DublinTime.dateString(event.start)}T12:00:00Z`).getUTCDay()];
      const time = DublinTime.timeString(event.start);
      const slot = (b: SplitBand) => sameDay(b.day, day) && b.start === time;
      const bands = split.bands.filter(slot);
      if (bands.length === 0) return [event];
      if (!bands.includes(mine)) return [];
      return [mine.room ? { ...event, locations: [mine.room] } : event];
    });
  },
};

/** "Lecture" or "lectures" against the class's kind, as the app names it. */
function sameActivity(activity: string, event: TimetableEvent): boolean {
  const word = activity.trim().toLowerCase().replace(/s$/, '');
  return word !== '' && word === kindLabel(event.activity.kind).toLowerCase();
}

/** "Tue", "tue" and "Tuesday" are the same day. */
function sameDay(written: string, day: string): boolean {
  return written.trim().slice(0, 3).toLowerCase() === day.toLowerCase();
}
