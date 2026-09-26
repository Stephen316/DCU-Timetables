import { parseActivityCode } from './activityCode';
import { DublinTime } from './time';
import { TimetableEvent, TimetableCategory, categoryCode, moduleCodeOf } from './timetableEvent';

// MARK: - Allocation

/**
 * A student's lab allocation: which group, and the rooms that follow from it. What a phone
 * downloads from `course_allocations` — no names, no IDs.
 */
export interface Allocation {
  group: string;
  subgroup: string | null;
  day: string | null;
  workshop: string | null;
  drawing: string | null;
}

/** Reads a `course_allocations` row, whose group column is `grp`. */
export function allocationFromRow(row: Record<string, unknown>): Allocation | null {
  if (typeof row.grp !== 'string') return null;
  const text = (v: unknown) => (typeof v === 'string' ? v : null);
  return { group: row.grp, subgroup: text(row.subgroup), day: text(row.day), workshop: text(row.workshop), drawing: text(row.drawing) };
}

// MARK: - Student profile

/** The only supported cohort for now. */
export type Cohort = 'engineeringYear1';
export const COHORTS: Cohort[] = ['engineeringYear1'];

/** The programme key the console saves this cohort's class list under. */
export function cohortCourseKey(cohort: Cohort): string {
  switch (cohort) {
    case 'engineeringYear1': return 'EEG1';
  }
}

export function cohortForCourseKey(courseKey: string): Cohort | null {
  return COHORTS.find((c) => cohortCourseKey(c) === courseKey) ?? null;
}

/**
 * A student's profile, created by matching their verified DCU address against the class
 * list an admin uploaded — on the server, by `resolve_allocation`.
 */
export interface StudentProfile {
  name: string;
  cohort: Cohort;
  /** Lab group letter, e.g. "D". */
  group: string;
  /** e.g. "D.1" */
  subgroup: string;
  /** Room, e.g. "SG23" */
  workshop: string;
  /** Room, e.g. "SB39" */
  drawing: string;
  /** Where the allocation came from, so a re-imported class list can be noticed. */
  courseKey: string | null;
  allocationKey: string | null;
  rosterVersion: number | null;
}

export function makeProfile(fields: Partial<StudentProfile> & { name: string; group: string }): StudentProfile {
  return {
    name: fields.name,
    cohort: fields.cohort ?? 'engineeringYear1',
    group: fields.group,
    subgroup: fields.subgroup ?? '',
    workshop: fields.workshop ?? '',
    drawing: fields.drawing ?? '',
    courseKey: fields.courseKey ?? null,
    allocationKey: fields.allocationKey ?? null,
    rosterVersion: fields.rosterVersion ?? null,
  };
}

/**
 * Built from what the server resolved. The name is the one from the student's own
 * address — the class list's copy of it never reaches the device.
 */
export function profileFromAllocation(
  name: string,
  cohort: Cohort,
  allocation: Allocation,
  allocationKey: string,
  rosterVersion: number,
): StudentProfile {
  return {
    name,
    cohort,
    group: allocation.group,
    subgroup: allocation.subgroup ?? '',
    workshop: allocation.workshop ?? '',
    drawing: allocation.drawing ?? '',
    courseKey: cohortCourseKey(cohort),
    allocationKey,
    rosterVersion,
  };
}

/** Reads a saved profile, or null when the blob isn't one. */
export function decodeProfile(value: unknown): StudentProfile | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.name !== 'string' || typeof v.group !== 'string') return null;
  if (v.cohort !== undefined && !COHORTS.includes(v.cohort as Cohort)) return null;
  const text = (x: unknown) => (typeof x === 'string' ? x : '');
  const opt = (x: unknown) => (typeof x === 'string' ? x : null);
  return {
    name: v.name,
    cohort: (v.cohort as Cohort | undefined) ?? 'engineeringYear1',
    group: v.group,
    subgroup: text(v.subgroup),
    workshop: text(v.workshop),
    drawing: text(v.drawing),
    courseKey: opt(v.courseKey),
    allocationKey: opt(v.allocationKey),
    rosterVersion: typeof v.rosterVersion === 'number' ? v.rosterVersion : null,
  };
}

// MARK: - Lab rotation

/**
 * One lab session in the Year-1 Engineering rotation (which groups attend which lab on a
 * given date). Sourced from the School of Engineering's published rotation. No personal data.
 */
export interface LabSession {
  week: number;
  /** ISO yyyy-MM-dd */
  date: string;
  /** "Tue" */
  day: string;
  /** "14:00" */
  start: string;
  end: string;
  /** "EEG1001" */
  module: string;
  /**
   * The column heading the session sits under in the School's PDF — "Workshop", "Drawing"
   * or "Lab". Per session, because one module runs two (see docs/ENGINEERING_LABS.md).
   */
  activity: string;
  groups: string[];
}

/**
 * The activity is part of the identity because the module alone is not: EEG1001 holds a
 * Workshop and a Drawing at the same hour on the same afternoon.
 */
export function labSessionID(session: LabSession): string {
  return `${session.module}-${session.activity}-${session.date}-${session.start}`;
}

export interface LabRotation {
  title: string;
  modules: Record<string, { name: string }>;
  sessions: LabSession[];
}

export const LabRotations = {
  /** Group letters referenced anywhere in the rotation, e.g. ["A","B","C","D","E"]. */
  groupLetters(rotation: LabRotation): string[] {
    return [...new Set(rotation.sessions.flatMap((s) => s.groups))].sort();
  },

  /** The module codes this rotation covers. */
  moduleCodes(rotation: LabRotation): Set<string> {
    return new Set(Object.keys(rotation.modules));
  },

  /** Sessions a group attends, by date then time. ISO dates sort correctly as strings. */
  sessionsForGroup(rotation: LabRotation, group: string): LabSession[] {
    return rotation.sessions
      .filter((s) => s.groups.includes(group))
      .sort((a, b) => (a.date === b.date ? compare(a.start, b.start) : compare(a.date, b.date)));
  },

  name(rotation: LabRotation, moduleCode: string): string {
    return rotation.modules[moduleCode]?.name ?? moduleCode;
  },

  /**
   * Checks the shape of a rotation read from JSON. A session without an activity is
   * refused: the old model without one is how 35 sessions got the wrong module.
   */
  decode(value: unknown): LabRotation | null {
    if (typeof value !== 'object' || value === null) return null;
    const v = value as Record<string, unknown>;
    if (typeof v.title !== 'string' || typeof v.modules !== 'object' || v.modules === null || !Array.isArray(v.sessions)) {
      return null;
    }
    const modules: Record<string, { name: string }> = {};
    for (const [code, info] of Object.entries(v.modules as Record<string, unknown>)) {
      const name = (info as { name?: unknown } | null)?.name;
      if (typeof name !== 'string') return null;
      modules[code] = { name };
    }
    const sessions: LabSession[] = [];
    for (const raw of v.sessions as unknown[]) {
      const s = raw as Record<string, unknown>;
      if (
        typeof s?.week !== 'number' || typeof s.date !== 'string' || typeof s.day !== 'string' ||
        typeof s.start !== 'string' || typeof s.end !== 'string' || typeof s.module !== 'string' ||
        typeof s.activity !== 'string' || !Array.isArray(s.groups) || !s.groups.every((g) => typeof g === 'string')
      ) {
        return null;
      }
      sessions.push({
        week: s.week, date: s.date, day: s.day, start: s.start, end: s.end,
        module: s.module, activity: s.activity, groups: s.groups as string[],
      });
    }
    return { title: v.title, modules, sessions };
  },
};

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// MARK: - Timetable changes

/**
 * A class removed from a course's timetable, or one added to it, for everyone on the
 * course or one group of it. Saved from the console (supabase/phase17_timetable_changes.sql).
 */
export interface TimetableChange {
  id: string;
  courseKey: string;
  /** "C", "C.2", or null for everyone on the course. */
  group: string | null;
  kind: 'remove' | 'add';
  module: string;
  /** Remove only: one activity code; null hides every class of the module starting then. */
  activityCode: string | null;
  title: string | null;
  /** Dublin calendar dates, yyyy-MM-dd. */
  dates: string[];
  start: string;
  end: string | null;
  room: string | null;
}

export function makeChange(fields: Partial<TimetableChange> & Pick<TimetableChange, 'id' | 'courseKey' | 'kind' | 'module' | 'dates' | 'start'>): TimetableChange {
  return {
    group: null, activityCode: null, title: null, end: null, room: null,
    ...fields,
  };
}

/** Reads a `timetable_changes` row. Null when it isn't one. */
export function changeFromRow(row: Record<string, unknown>): TimetableChange | null {
  const opt = (v: unknown) => (typeof v === 'string' ? v : null);
  if (
    typeof row.id !== 'string' || typeof row.course_key !== 'string' ||
    (row.kind !== 'remove' && row.kind !== 'add') || typeof row.module !== 'string' ||
    !Array.isArray(row.dates) || typeof row.start_time !== 'string'
  ) {
    return null;
  }
  return {
    id: row.id,
    courseKey: row.course_key,
    group: opt(row.grp),
    kind: row.kind,
    module: row.module,
    activityCode: opt(row.activity_code),
    title: opt(row.title),
    dates: (row.dates as unknown[]).filter((d): d is string => typeof d === 'string'),
    start: row.start_time,
    end: opt(row.end_time),
    room: opt(row.room),
  };
}

/** Who is looking at a timetable, as far as changes are concerned. */
export class TimetableAudience {
  readonly group: string | null;
  readonly subgroup: string | null;

  constructor(readonly courseKey: string, group: string | null = null, subgroup: string | null = null) {
    this.group = group === '' ? null : group;
    this.subgroup = subgroup === '' ? null : subgroup;
  }

  /**
   * DCU programme codes the console groups under one course key. Mirrors `covers` in
   * web/src/lib/proposals/courses.ts: the six programmes sharing Engineering's first year.
   */
  static readonly programmeCourses: Record<string, string> = {
    BMED1: 'EEG1', CAM1: 'EEG1', CE1: 'EEG1', ECE1: 'EEG1', ME1: 'EEG1', SSE1: 'EEG1',
  };

  /** A student on a programme they picked has no group, so only course-wide changes reach them. */
  static forProgramme(code: string): TimetableAudience | null {
    const course = TimetableAudience.programmeCourses[code.toUpperCase()];
    return course ? new TimetableAudience(course) : null;
  }

  static forProfile(profile: StudentProfile): TimetableAudience {
    return new TimetableAudience(profile.courseKey ?? cohortCourseKey(profile.cohort), profile.group, profile.subgroup);
  }

  static forCategory(category: TimetableCategory): TimetableAudience | null {
    return TimetableAudience.forProgramme(categoryCode(category));
  }

  includes(change: TimetableChange): boolean {
    if (change.courseKey !== this.courseKey) return false;
    if (change.group === null) return true;
    return change.group === this.group || change.group === this.subgroup;
  }
}

export const TimetableChanges = {
  /**
   * A week's events with this audience's changes applied: removals hidden, additions in the
   * week put in. `weekStart` bounds the additions; without it none are added.
   */
  apply(
    events: TimetableEvent[],
    changes: TimetableChange[],
    audience: TimetableAudience | null,
    weekStart: Date | null,
  ): TimetableEvent[] {
    if (audience === null) return events;
    const mine = changes.filter((c) => audience.includes(c));
    if (mine.length === 0) return events;

    const removals = mine.filter((c) => c.kind === 'remove');
    const out = events.filter((event) => {
      const date = DublinTime.dateString(event.start);
      const time = DublinTime.timeString(event.start);
      return !removals.some(
        (r) =>
          r.module === moduleCodeOf(event) && r.start === time && r.dates.includes(date) &&
          (r.activityCode === null || r.activityCode === TimetableChanges.code(event.activity.raw)),
      );
    });

    if (weekStart !== null) {
      // Whole days on the Dublin calendar, counted from the Dublin date the week starts on.
      const [y, m, d] = DublinTime.dateString(weekStart).split('-').map(Number);
      const days = new Set(
        Array.from({ length: 7 }, (_, offset) => new Date(Date.UTC(y, m - 1, d + offset)).toISOString().slice(0, 10)),
      );
      for (const add of mine) {
        if (add.kind !== 'add') continue;
        for (const date of add.dates) {
          if (!days.has(date)) continue;
          const event = added(add, date);
          if (event) out.push(event);
        }
      }
    }
    return out.sort((a, b) => a.start.getTime() - b.start.getTime());
  },

  /**
   * The code the console matches on: the first word, without a cross-listing comma.
   * "EEG1002[1]OC/L1/01 <2, 4>" → "EEG1002[1]OC/L1/01" (web/src/lib/dcu/timetable.ts).
   */
  code(raw: string): string {
    const first = raw.trim().split(' ').find((w) => w.length > 0) ?? '';
    return first.replace(/^,+|,+$/g, '');
  },
};

function added(change: TimetableChange, date: string): TimetableEvent | null {
  if (change.end === null) return null;
  const start = DublinTime.date(date, change.start);
  const end = DublinTime.date(date, change.end);
  if (!start || !end) return null;
  const title = change.title ?? 'Class';
  return {
    id: `change-${change.id}-${date}`,
    start,
    end,
    type: 'onCampus',
    locations: change.room !== null ? [change.room] : [],
    moduleName: `${title} · ${change.module}`,
    staff: [],
    activity: parseActivityCode(change.module),
    weekLabels: [],
  };
}
