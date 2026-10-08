import { isoSeconds, DublinTime } from './time';
import { TimetableEvent } from './timetableEvent';

/**
 * A student's own change to their timetable: a class of their course they've taken on, or
 * one of theirs they've dropped, just once or every week it runs. Device-local and never
 * shared, as "I won't attend" was before it: a private choice about one person's week, and
 * uploading it would turn the app into an attendance record.
 */
export interface TimetableEdit {
  kind: 'add' | 'remove';
  repeat: EditRepeat;
  /** The class's activity code, `event.activity.raw`. */
  activity: string;
  /**
   * DCU's name for it. Tells apart two classes the code doesn't: a lab rotation's Workshop and
   * Drawing are both just "EEG1001". Null matches any name — an edit carried over from the old
   * not-attending list, which kept only the code.
   */
  name: string | null;
  /** Dublin weekday, 0 = Sunday. */
  weekday: number;
  /** "14:00", Dublin time. */
  start: string;
  /** "2026-10-14" for a once-off; null for every week. */
  date: string | null;
}

export type EditRepeat = 'once' | 'weekly';

/** What the student sees in edit mode: their week, and the course's other classes as ghosts. */
export interface EditedWeek {
  events: TimetableEvent[];
  ghosts: TimetableEvent[];
}

export const TimetableEdits = {
  make(kind: TimetableEdit['kind'], repeat: EditRepeat, event: TimetableEvent): TimetableEdit {
    const date = DublinTime.dateString(event.start);
    return {
      kind,
      repeat,
      activity: event.activity.raw,
      name: event.moduleName,
      weekday: weekdayOf(date),
      start: DublinTime.timeString(event.start),
      date: repeat === 'once' ? date : null,
    };
  },

  /**
   * The list with `edit` added and whatever it overrides taken out: an every-week edit
   * replaces all earlier edits of that class, a once-off only the earlier once-off that day.
   * So the list never holds two answers to the same question.
   */
  adding(edits: TimetableEdit[], edit: TimetableEdit): TimetableEdit[] {
    const overridden = (e: TimetableEdit) => sameSlot(e, edit) && (edit.date === null || e.date === edit.date);
    return [...edits.filter((e) => !overridden(e)), edit];
  },

  /**
   * What the student has said about this class: a once-off for its day beats an every-week
   * edit, which beats nothing said. Null when nothing applies, and it's as the course has it.
   */
  decision(event: TimetableEvent, edits: TimetableEdit[]): TimetableEdit['kind'] | null {
    const date = DublinTime.dateString(event.start);
    const matching = edits.filter((e) => matches(e, event, date));
    return (matching.find((e) => e.date !== null) ?? matching.find((e) => e.date === null))?.kind ?? null;
  },

  /**
   * The week with the student's edits applied. `mine` is what the course gives them; `others`
   * the classes of their course it doesn't. A dropped class of theirs becomes a ghost, so it
   * can be put back.
   */
  apply(mine: TimetableEvent[], others: TimetableEvent[], edits: TimetableEdit[]): EditedWeek {
    if (edits.length === 0) return { events: mine, ghosts: others };
    const events: TimetableEvent[] = [];
    const ghosts: TimetableEvent[] = [];
    for (const e of mine) (TimetableEdits.decision(e, edits) === 'remove' ? ghosts : events).push(e);
    for (const e of others) (TimetableEdits.decision(e, edits) === 'add' ? events : ghosts).push(e);
    const byStart = (a: TimetableEvent, b: TimetableEvent) => a.start.getTime() - b.start.getTime();
    return { events: events.sort(byStart), ghosts: ghosts.sort(byStart) };
  },

  /** Reads the saved list, dropping anything that isn't an edit. */
  decode(value: unknown): TimetableEdit[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((raw): TimetableEdit[] => {
      const v = raw as Record<string, unknown> | null;
      if (
        (v?.kind !== 'add' && v?.kind !== 'remove') || (v.repeat !== 'once' && v.repeat !== 'weekly') ||
        typeof v.activity !== 'string' || typeof v.weekday !== 'number' || typeof v.start !== 'string' ||
        (v.repeat === 'once') !== (typeof v.date === 'string')
      ) {
        return [];
      }
      return [{
        kind: v.kind, repeat: v.repeat, activity: v.activity, name: typeof v.name === 'string' ? v.name : null,
        weekday: v.weekday, start: v.start, date: typeof v.date === 'string' ? v.date : null,
      }];
    });
  },

  /**
   * The old "I won't attend" list as once-off removals, so a class marked before this change
   * stays off. Its keys are `CancellationRules.eventKey`: the code, then the start in UTC.
   */
  fromSkipped(keys: string[]): TimetableEdit[] {
    return keys.flatMap((key): TimetableEdit[] => {
      const bar = key.lastIndexOf('|');
      const start = new Date(key.slice(bar + 1));
      if (bar <= 0 || Number.isNaN(start.getTime()) || isoSeconds(start) !== key.slice(bar + 1)) return [];
      const date = DublinTime.dateString(start);
      return [{
        kind: 'remove', repeat: 'once', activity: key.slice(0, bar), name: null,
        weekday: weekdayOf(date), start: DublinTime.timeString(start), date,
      }];
    });
  },
};

function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/** The same class at the same point in the week — whatever the day or the kind of edit. */
function sameSlot(a: TimetableEdit, b: TimetableEdit): boolean {
  return a.activity === b.activity && a.name === b.name && a.weekday === b.weekday && a.start === b.start;
}

function matches(edit: TimetableEdit, event: TimetableEvent, date: string): boolean {
  return (
    edit.activity === event.activity.raw &&
    (edit.name === null || edit.name === event.moduleName) &&
    edit.start === DublinTime.timeString(event.start) &&
    (edit.date === null ? edit.weekday === weekdayOf(date) : edit.date === date)
  );
}
