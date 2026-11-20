import { ActivityKind, parseActivityCode } from './activityCode';
import { addDays, DublinTime, startOfDay } from './time';
import { TimetableEvent } from './timetableEvent';

/**
 * A class the student put on their timetable at a time of their own choosing, for one DCU
 * doesn't list then: a lecture moved by email, a make-up lab, a tutorial arranged after
 * class. Kept on the device alone, like the rest of their edits.
 */
export interface CustomClass {
  id: string;
  /** The module code, "MS121". */
  code: string;
  /** Their own name for it, if any; else the code stands for it. */
  title: string | null;
  kind: CustomKind;
  /** "2026-11-19": the day it's on, or the first week it's on for an every-week class. */
  date: string;
  /** "14:00" and "15:00", Dublin time. */
  start: string;
  end: string;
  repeat: 'once' | 'weekly';
  room: string | null;
}

/** The kinds a student can set: lecture, lab, tutorial. */
export type CustomKind = Extract<ActivityKind, 'L' | 'P' | 'T'>;
export const CUSTOM_KINDS: CustomKind[] = ['L', 'P', 'T'];

/** Every custom class's event id starts with this, so the app can tell them from DCU's. */
const ID_PREFIX = 'custom-';

export const CustomClasses = {
  isCustom(event: TimetableEvent): boolean {
    return event.id.startsWith(ID_PREFIX);
  },

  /** The saved class an event was made from. */
  idOf(event: TimetableEvent): string | null {
    if (!CustomClasses.isCustom(event)) return null;
    const rest = event.id.slice(ID_PREFIX.length);
    // The id is followed by the date it's drawn on: "custom-<id>-2026-11-19".
    return rest.length > 11 ? rest.slice(0, -11) : null;
  },

  /** The occurrences that fall in the 7 days from `weekStart`, as timetable events. */
  eventsIn(classes: CustomClass[], weekStart: Date): TimetableEvent[] {
    const first = startOfDay(weekStart);
    const days = Array.from({ length: 7 }, (_, i) => DublinTime.dateString(addDays(first, i)));
    return classes.flatMap((c) => days.flatMap((day) => (occursOn(c, day) ? toEvent(c, day) : [])));
  },

  /** Reads the saved list, dropping anything that isn't a custom class. */
  decode(value: unknown): CustomClass[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((raw): CustomClass[] => {
      const v = raw as Record<string, unknown> | null;
      if (
        typeof v?.id !== 'string' || typeof v.code !== 'string' || !CUSTOM_KINDS.includes(v.kind as CustomKind) ||
        typeof v.date !== 'string' || !isDate(v.date) || typeof v.start !== 'string' || !isTime(v.start) ||
        typeof v.end !== 'string' || !isTime(v.end) || v.end <= v.start || (v.repeat !== 'once' && v.repeat !== 'weekly')
      ) {
        return [];
      }
      return [{
        id: v.id, code: v.code, title: typeof v.title === 'string' && v.title.trim() ? v.title.trim() : null,
        kind: v.kind as CustomKind, date: v.date, start: v.start, end: v.end, repeat: v.repeat,
        room: typeof v.room === 'string' && v.room.trim() ? v.room.trim() : null,
      }];
    });
  },
};

/** "14:00" and an hour count to "15:00", or null past midnight. */
export function timeAfter(start: string, minutes: number): string | null {
  const [h, m] = start.split(':').map(Number);
  const total = h * 60 + m + minutes;
  if (total >= 24 * 60) return null;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function isDate(text: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(text);
}

function isTime(text: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text);
}

function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function occursOn(c: CustomClass, day: string): boolean {
  return c.repeat === 'once' ? c.date === day : day >= c.date && weekdayOf(day) === weekdayOf(c.date);
}

function toEvent(c: CustomClass, day: string): TimetableEvent[] {
  const start = DublinTime.date(day, c.start);
  const end = DublinTime.date(day, c.end);
  if (!start || !end) return [];
  return [{
    id: `${ID_PREFIX}${c.id}-${day}`,
    start,
    end,
    type: 'onCampus',
    locations: c.room ? [c.room] : [],
    // "MS121 Statistics", as DCU names a module, so the grid shortens it the same way.
    moduleName: c.title ? `${c.code} ${c.title}` : c.code,
    staff: [],
    activity: parseActivityCode(`${c.code}[1]OC/${c.kind}1`),
    weekLabels: [],
  }];
}
