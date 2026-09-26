import { TimetableEvent } from './timetableEvent';
import { addDays, daysBetween, isWeekend, MINUTE, startOfDay } from './time';

// MARK: - The day view

/** A stretch of a day with nothing timetabled in it. */
export interface DayGap {
  start: Date;
  end: Date;
}

export function gapMinutes(gap: DayGap): number {
  return Math.round((gap.end.getTime() - gap.start.getTime()) / MINUTE);
}

/** One row however long the gap is — five free hours read as "5 hours free". */
export function gapLabel(gap: DayGap): string {
  return DaySchedule.freeLabel(gapMinutes(gap));
}

/** One line of the day view: a class, or the empty stretch before the next one. */
export type DaySlot = { kind: 'session'; event: TimetableEvent } | { kind: 'gap'; gap: DayGap };

export function slotID(slot: DaySlot): string {
  return slot.kind === 'session' ? slot.event.id : `gap-${slot.gap.start.getTime() / 1000}`;
}

export const DaySchedule = {
  /** Below this, the space between two classes is the walk between rooms, not free time. */
  shortestGapMinutes: 15,

  /**
   * Classes in order with the gaps between them filled in. Gaps are measured from the
   * latest end time seen so far, so two overlapping lectures can't leave a gap that runs
   * backwards. Nothing is added before the first class or after the last.
   */
  slots(events: TimetableEvent[]): DaySlot[] {
    const ordered = [...events].sort((a, b) => a.start.getTime() - b.start.getTime());
    const slots: DaySlot[] = [];
    let covered: Date | null = null;
    for (const event of ordered) {
      if (covered !== null && event.start.getTime() - covered.getTime() >= DaySchedule.shortestGapMinutes * MINUTE) {
        slots.push({ kind: 'gap', gap: { start: covered, end: event.start } });
      }
      slots.push({ kind: 'session', event });
      covered = covered === null || event.end.getTime() > covered.getTime() ? event.end : covered;
    }
    return slots;
  },

  /** "45 min free", "1 hour free", "2 hr 30 min free". */
  freeLabel(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    if (hours === 0) return `${remainder} min free`;
    if (remainder === 0) return hours === 1 ? '1 hour free' : `${hours} hours free`;
    return `${hours} hr ${remainder} min free`;
  },

  /** Total free time between the first and last class, for the day's header. */
  freeMinutes(slots: DaySlot[]): number {
    return slots.reduce((total, slot) => (slot.kind === 'gap' ? total + gapMinutes(slot.gap) : total), 0);
  },
};

// MARK: - Which day to open on

/**
 * Which weekday the day view opens on. Today, except that from 6pm the day is effectively
 * over, and a weekend rolls forward to the next Monday — which is why the answer can't be a
 * bare day index: on Friday evening the day wanted is in the *following* week.
 */
export const DefaultDay = {
  rolloverHour: 18,

  target(weekStart: Date, now: Date = new Date()): { weekStep: number; dayIndex: number } {
    const day = teachingDay(now);
    const offset = daysBetween(startOfDay(weekStart), day);
    if (offset >= 0 && offset <= 4) return { weekStep: 0, dayIndex: offset };
    // Friday evening and the weekend: already rolled to a Monday, so the next week's.
    if (offset >= 5 && offset <= 7) return { weekStep: 1, dayIndex: offset - 7 };
    // The student has paged away: Monday of whatever they're looking at.
    return { weekStep: 0, dayIndex: 0 };
  },
};

function teachingDay(now: Date): Date {
  const today = startOfDay(now);
  let day = now.getHours() >= DefaultDay.rolloverHour ? addDays(today, 1) : today;
  while (isWeekend(day)) day = addDays(day, 1);
  return day;
}

// MARK: - The week grid

export interface PlacedEvent {
  event: TimetableEvent;
  /** Which side-by-side column this class occupies (0-based). */
  column: number;
  /** How many columns its overlapping cluster needs, i.e. the width divisor. */
  columnCount: number;
}

/**
 * Calendar-grid placement for one day's classes. Overlapping runs are split into
 * side-by-side columns (the standard calendar layout).
 */
export const WeekGrid = {
  place(events: TimetableEvent[]): PlacedEvent[] {
    const sorted = [...events].sort((a, b) =>
      a.start.getTime() === b.start.getTime()
        ? a.end.getTime() - b.end.getTime()
        : a.start.getTime() - b.start.getTime(),
    );
    const result: PlacedEvent[] = [];
    let cluster: TimetableEvent[] = [];
    let clusterEnd: number | null = null;

    const flush = () => {
      if (cluster.length === 0) return;
      const columnEnds: number[] = [];
      const assignments: [TimetableEvent, number][] = [];
      for (const event of cluster) {
        const free = columnEnds.findIndex((end) => end <= event.start.getTime());
        if (free >= 0) {
          columnEnds[free] = event.end.getTime();
          assignments.push([event, free]);
        } else {
          columnEnds.push(event.end.getTime());
          assignments.push([event, columnEnds.length - 1]);
        }
      }
      for (const [event, column] of assignments) result.push({ event, column, columnCount: columnEnds.length });
      cluster = [];
      clusterEnd = null;
    };

    for (const event of sorted) {
      if (clusterEnd !== null && event.start.getTime() < clusterEnd) {
        cluster.push(event);
        clusterEnd = Math.max(clusterEnd, event.end.getTime());
      } else {
        flush();
        cluster = [event];
        clusterEnd = event.end.getTime();
      }
    }
    flush();
    return result;
  },
};

// MARK: - Clashes

export interface Clash {
  a: TimetableEvent;
  b: TimetableEvent;
}

/**
 * Pure clash detection. Meaningful only *after* events are filtered to the student's chosen
 * groups — a raw programme timetable would otherwise clash with itself.
 */
export const ClashDetector = {
  clashes(events: TimetableEvent[]): Clash[] {
    const sorted = [...events].sort((a, b) => a.start.getTime() - b.start.getTime());
    const result: Clash[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i];
      for (let j = i + 1; j < sorted.length; j++) {
        const b = sorted[j];
        if (b.start.getTime() >= a.end.getTime()) break; // sorted by start ⇒ nothing later overlaps a
        if (overlaps(a, b)) result.push({ a, b });
      }
    }
    return result;
  },

  clashingEventIDs(events: TimetableEvent[]): Set<string> {
    const ids = new Set<string>();
    for (const clash of ClashDetector.clashes(events)) {
      ids.add(clash.a.id);
      ids.add(clash.b.id);
    }
    return ids;
  },
};

function overlaps(a: TimetableEvent, b: TimetableEvent): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

// MARK: - The next class

/** The pieces of a class the next-class rule looks at. */
export interface TimedItem {
  id: string;
  start: Date;
  end: Date;
}

/**
 * When a class is *the* class to be heading to. The window opens half the class's length
 * before it starts and closes once the class is half over: a two-hour lecture at 09:00 is
 * highlighted from 08:00 until 10:00. Half-open, so two classes can never both claim the
 * same instant by touching at an edge.
 */
export const NextClassWindow = {
  /** Floored at five minutes so a zero-length event still has a window. */
  halfLength(item: TimedItem): number {
    return Math.max((item.end.getTime() - item.start.getTime()) / 2, 5 * MINUTE);
  },

  window(item: TimedItem): { lower: Date; upper: Date } {
    const half = NextClassWindow.halfLength(item);
    return { lower: new Date(item.start.getTime() - half), upper: new Date(item.start.getTime() + half) };
  },

  /**
   * The class to highlight now, or nothing when no window is open. Where windows overlap,
   * the class whose start is nearest wins; ties go to whichever starts first.
   */
  highlighted<T extends TimedItem>(classes: T[], now: Date): T | null {
    let best: T | null = null;
    for (const item of classes) {
      const { lower, upper } = NextClassWindow.window(item);
      if (now.getTime() < lower.getTime() || now.getTime() >= upper.getTime()) continue;
      if (best === null) {
        best = item;
        continue;
      }
      const a = Math.abs(item.start.getTime() - now.getTime());
      const b = Math.abs(best.start.getTime() - now.getTime());
      if (a < b || (a === b && item.start.getTime() < best.start.getTime())) best = item;
    }
    return best;
  },
};
