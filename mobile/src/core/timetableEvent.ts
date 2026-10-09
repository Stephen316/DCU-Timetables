import { ActivityCode, kindLabel, parseActivityCode } from './activityCode';

/** How a class is delivered. Mapped from the API's free-text `EventType` string. */
export type EventType = 'onCampus' | 'synchronous' | 'asynchronous' | 'booking' | 'unknown';

export function eventTypeFromAPI(raw: string | null | undefined): EventType {
  const s = (raw ?? '').toLowerCase();
  if (s.includes('on campus') || s.includes('on-campus')) return 'onCampus';
  if (s.includes('async')) return 'asynchronous';
  if (s.includes('sync')) return 'synchronous';
  if (s.includes('booking')) return 'booking';
  return 'unknown';
}

export function eventTypeLabel(type: EventType): string {
  switch (type) {
    case 'onCampus': return 'On campus';
    case 'synchronous': return 'Online (live)';
    case 'asynchronous': return 'Recorded';
    case 'booking': return 'Booking';
    case 'unknown': return 'Class';
  }
}

/** One class in a timetable — the Core domain type the UI renders. */
export interface TimetableEvent {
  id: string;
  start: Date;
  end: Date;
  type: EventType;
  locations: string[];
  moduleName: string | null;
  staff: string[];
  activity: ActivityCode;
  weekLabels: string[];
  /**
   * The heading an admin chose for the module in the console, in place of DCU's name. Put on
   * by `ModuleTitles.apply`; never stored.
   */
  heading?: string;
  /** The module's name on the week grid, set on the console's Timetable page. Put on by `ModuleAbbreviations.apply`. */
  abbreviation?: string;
}

/** A module's heading, as saved in the console (`module_titles`). */
export interface ModuleTitle {
  moduleKey: string;
  title: string;
}

export const ModuleTitles = {
  /** Headings onto DCU's classes. Run before changes, so an added class keeps its own name. */
  apply(events: TimetableEvent[], titles: ModuleTitle[]): TimetableEvent[] {
    if (titles.length === 0) return events;
    const byModule = new Map(titles.map((t) => [t.moduleKey, t]));
    return events.map((e) => {
      const t = e.activity.moduleCode ? byModule.get(e.activity.moduleCode) : undefined;
      return t ? { ...e, heading: t.title } : e;
    });
  },

  fromRow(row: Record<string, unknown>): ModuleTitle | null {
    const { module_key: moduleKey, title } = row;
    if (typeof moduleKey !== 'string' || typeof title !== 'string' || !title.trim()) return null;
    return { moduleKey, title: title.trim() };
  },
};

export function moduleCodeOf(event: TimetableEvent): string | null {
  return event.activity.moduleCode;
}

/** Best available title: module name, else module code, else the raw activity code. */
export function titleOf(event: TimetableEvent): string {
  return event.moduleName ?? event.activity.moduleCode ?? event.activity.raw;
}

/**
 * The title without the code DCU puts in front of the module's name — "EEG1006[1] Materials
 * Engineering" reads "Materials Engineering". For the day view; the class's own page keeps
 * the code. A name that is only the code, or doesn't start with it, is left whole. A
 * heading set in the console wins over DCU's name.
 */
export function shortTitleOf(event: TimetableEvent): string {
  if (event.heading) return event.heading;
  const name = event.moduleName;
  const code = event.activity.moduleCode;
  if (!name || !code || !name.startsWith(code)) return titleOf(event);
  return /^\S+\s+(\S.*)$/.exec(name)?.[1] ?? name;
}

/** Long words in DCU's module names, as a timetable would shorten them. */
const ABBREVIATIONS: Record<string, string> = {
  engineering: 'Eng.', fundamentals: 'Fund.', professional: 'Prof.', development: 'Dev.',
  technical: 'Tech.', technology: 'Tech.', mathematics: 'Maths', introduction: 'Intro.',
  laboratory: 'Lab', programming: 'Prog.', management: 'Mgmt', electronic: 'Elec.',
  electronics: 'Elec.', electrical: 'Elec.', mechanical: 'Mech.', manufacturing: 'Mfg.',
  computer: 'Comp.', computing: 'Comp.', communication: 'Comms', communications: 'Comms',
  chemistry: 'Chem.', statistics: 'Stats', principles: 'Princ.', applications: 'Apps',
  environmental: 'Env.', information: 'Info.',
};

/**
 * The short title squeezed for a narrow block on the week grid: "Fundamentals of
 * Professional Development" reads "Fund. of Prof. Dev.". Words it doesn't know are kept.
 */
export function compactTitleOf(event: TimetableEvent): string {
  // The console sets the week grid's names (Timetable page); anything else is shortened.
  if (event.abbreviation) return event.abbreviation;
  return shortTitleOf(event)
    .split(/\s+/)
    .filter((word) => word.toLowerCase() !== 'the')
    .map((word) => (word.toLowerCase() === 'and' ? '&' : ABBREVIATIONS[word.toLowerCase()] ?? word))
    .join(' ');
}

/** Taught online, live or recorded — including a class that also has a room. */
export function isOnline(event: TimetableEvent): boolean {
  return event.type === 'synchronous' || event.type === 'asynchronous';
}

export function staffText(event: TimetableEvent): string | null {
  return event.staff.length === 0 ? null : event.staff.join(', ');
}

/**
 * Stable identifier for the attendance group this event belongs to — module + activity
 * kind/index + group number + cohort. Two events with the same key are the same weekly
 * group; different keys are groups a student chooses between.
 */
export function groupKeyOf(event: TimetableEvent): string {
  const a = event.activity;
  return [
    a.moduleCode ?? a.raw,
    `${a.kind}${a.activityIndex ?? ''}`,
    a.group ?? '',
    a.cohort ?? '',
  ].join('|');
}

/** Human label for the group, e.g. "Lab P1", "Tutorial T1 · Grp 02 · Surname A - M". */
export function groupLabelOf(event: TimetableEvent): string {
  const a = event.activity;
  const parts = [`${kindLabel(a.kind)} ${a.kind}${a.activityIndex ?? ''}`];
  if (a.group) parts.push(`Grp ${a.group}`);
  if (a.cohort) parts.push(a.cohort);
  return parts.join(' · ');
}

// MARK: - Storage

/** The JSON shape a cached event is written in. Dates as ISO strings, the code as text. */
export interface StoredEvent {
  id: string;
  start: string;
  end: string;
  type: EventType;
  locations: string[];
  moduleName: string | null;
  staff: string[];
  activity: string;
  weekLabels: string[];
}

export function storeEvent(event: TimetableEvent): StoredEvent {
  return {
    id: event.id,
    start: event.start.toISOString(),
    end: event.end.toISOString(),
    type: event.type,
    locations: event.locations,
    moduleName: event.moduleName,
    staff: event.staff,
    activity: event.activity.raw,
    weekLabels: event.weekLabels,
  };
}

export function restoreEvent(stored: StoredEvent): TimetableEvent {
  return {
    id: stored.id,
    start: new Date(stored.start),
    end: new Date(stored.end),
    type: stored.type,
    locations: stored.locations,
    moduleName: stored.moduleName,
    staff: stored.staff,
    activity: parseActivityCode(stored.activity),
    weekLabels: stored.weekLabels,
  };
}

// MARK: - Categories and weeks

/** A searchable timetable object: a programme of study, a module, or a room. */
export interface TimetableCategory {
  /** UUID used in event requests. */
  identity: string;
  /** e.g. "AC1 (Chem & Pharma Science-1)" */
  name: string;
  categoryTypeIdentity: string;
}

/** The leading code, e.g. "AC1" from "AC1 (Chem & Pharma Science-1)". */
export function categoryCode(category: TimetableCategory): string {
  const space = category.name.indexOf(' ');
  return space >= 0 ? category.name.slice(0, space) : category.name;
}

/** The descriptive part, e.g. "Chem & Pharma Science-1". */
export function categoryDescriptiveName(category: TimetableCategory): string {
  const space = category.name.indexOf(' ');
  if (space < 0) return '';
  return category.name
    .slice(space)
    .trim()
    .replace(/^[()]+|[()]+$/g, '')
    .trim();
}

/** The DCU category types (their GUIDs are fixed for the institution — see docs/API.md). */
export const CategoryType = {
  programme: '241e4d36-60e0-49f8-b27e-99416745d98d',
  module: '525fe79b-73c3-4b5c-8186-83c652b3adcc',
  location: '1e042cb1-547d-41d4-ae93-a1f2c3d34538',
} as const;

/** One teaching week, as defined by DCU. */
export interface TeachingWeek {
  number: number;
  label: string;
  firstDay: Date;
}

/** A day option offered by the API (used to build a complete event request). */
export interface DayOption {
  name: string;
  dayOfWeek: number;
}

/** The institution's week calendar for the current academic year. */
export class WeekCalendar {
  readonly weeks: TeachingWeek[];

  constructor(weeks: TeachingWeek[], readonly days: DayOption[]) {
    this.weeks = [...weeks].sort((a, b) => a.firstDay.getTime() - b.firstDay.getTime());
  }

  /** The teaching week containing `date`, if any. */
  weekContaining(date: Date): TeachingWeek | null {
    let found: TeachingWeek | null = null;
    for (const week of this.weeks) {
      if (week.firstDay.getTime() <= date.getTime()) found = week;
    }
    return found;
  }

  /** The current teaching week (or the first, out of term). */
  current(now: Date = new Date()): TeachingWeek | null {
    return this.weekContaining(now) ?? this.weeks[0] ?? null;
  }
}
