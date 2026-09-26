import { isLetter } from './activityCode';
import { TimetableEvent } from './timetableEvent';

// MARK: - Lecturers

/**
 * A member of staff named on a class. The timetable API gives a name and nothing else, and
 * DCU publishes no directory of photos, so everyone gets initials — honest rather than a
 * broken image.
 */
export interface Lecturer {
  name: string;
  photoURL: string | null;
  role: string | null;
}

export function makeLecturer(name: string, photoURL: string | null = null, role: string | null = null): Lecturer {
  return { name, photoURL, role };
}

/** The API writes staff surname-first ("Harcourt, Stephen"); people read the other way. */
export function lecturerDisplayName(lecturer: Lecturer): string {
  const comma = lecturer.name.indexOf(',');
  if (comma < 0) return lecturer.name.trim();
  const surname = lecturer.name.slice(0, comma).trim();
  const given = lecturer.name.slice(comma + 1).trim();
  if (given.length === 0 || surname.length === 0) return lecturer.name.trim();
  return `${given} ${surname}`;
}

/** Up to two letters for the fallback avatar: the first and last names' first letters. */
export function lecturerInitials(lecturer: Lecturer): string {
  const words = lecturerDisplayName(lecturer).split(/[ -]/).filter((w) => w.length > 0);
  const letters = words
    .map((w) => Array.from(w).find(isLetter))
    .filter((l): l is string => l !== undefined);
  if (letters.length === 0) return '?';
  if (letters.length > 1) return (letters[0] + letters[letters.length - 1]).toUpperCase();
  return letters[0].toUpperCase();
}

/**
 * Optional extra detail about staff, from `assets/data/lecturers.json`:
 * `[{"name": "Harcourt, Stephen", "photo": "https://…", "role": "Assistant Professor"}]`.
 * An empty list means every lecturer shows initials.
 */
export class LecturerDirectory {
  private readonly entries = new Map<string, { photo: string | null; role: string | null }>();

  constructor(raw: unknown) {
    if (!Array.isArray(raw)) return;
    for (const item of raw) {
      const e = item as { name?: unknown; photo?: unknown; role?: unknown };
      if (typeof e?.name !== 'string') continue;
      const key = LecturerDirectory.normalise(e.name);
      if (this.entries.has(key)) continue;
      this.entries.set(key, {
        photo: typeof e.photo === 'string' ? e.photo : null,
        role: typeof e.role === 'string' ? e.role : null,
      });
    }
  }

  /** Name parts regardless of order, so "Harcourt, Stephen" and "Stephen Harcourt" match. */
  private static normalise(name: string): string {
    return Array.from(name.toLowerCase())
      .filter((ch) => isLetter(ch) || /\s/.test(ch))
      .join('')
      .split(/\s+/)
      .filter((w) => w.length > 0)
      .sort()
      .join(' ');
  }

  lecturer(name: string): Lecturer {
    const entry = this.entries.get(LecturerDirectory.normalise(name));
    return makeLecturer(name, entry?.photo ?? null, entry?.role ?? null);
  }

  lecturersFor(event: TimetableEvent): Lecturer[] {
    return event.staff.map((name) => this.lecturer(name));
  }
}

// MARK: - Attendance

/**
 * Classes the student has marked "I won't attend". Device-local and never shared: a
 * private choice about one person's day, and uploading it would turn the app into an
 * attendance record.
 */
export const Attendance = {
  storageKey: 'skippedEvents',

  toggling(key: string, keys: string[]): string[] {
    return keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key];
  },
};

// MARK: - Pagers

/**
 * What a pager does when a swipe would run off the end: wrap round to the other end, or
 * stop there. The week and day pagers both stop at the ends of the academic year.
 */
export type PagerBounds = 'wrapping' | 'clamped';

export const PagerIndex = {
  /** The page to show at `value`, or null when there is no such page. */
  resolve(value: number, count: number, bounds: PagerBounds): number | null {
    if (count <= 0) return null;
    if (bounds === 'wrapping') return ((value % count) + count) % count;
    return value >= 0 && value < count ? value : null;
  },

  /** Where a step lands. A clamped pager stays put rather than jumping to the other end. */
  step(index: number, delta: number, count: number, bounds: PagerBounds): number {
    if (count <= 0) return 0;
    if (bounds === 'wrapping') return PagerIndex.resolve(index + delta, count, 'wrapping') ?? 0;
    return Math.min(Math.max(index + delta, 0), count - 1);
  },

  /** Whether a step would actually move — drives the chevrons' enabled state. */
  canStep(index: number, delta: number, count: number, bounds: PagerBounds): boolean {
    if (count <= 0) return false;
    return PagerIndex.step(index, delta, count, bounds) !== index;
  },
};

/**
 * The day pager runs through every weekday of the year as one sequence, so a swipe past
 * Friday lands on the next week's Monday and one before Monday on the previous Friday.
 */
export const WeekdayIndex = {
  daysPerWeek: 5,

  flat(week: number, day: number): number {
    return week * WeekdayIndex.daysPerWeek + day;
  },

  split(index: number): { week: number; day: number } {
    const n = WeekdayIndex.daysPerWeek;
    return { week: Math.floor(index / n), day: ((index % n) + n) % n };
  },
};

/**
 * Whether a swipe is in progress, shared from the pager down to the rows inside it. At the
 * end of a horizontal swipe the finger lifting can read as a tap on whatever the swipe
 * started on; each tappable row checks this before acting.
 */
export class PagerDragState {
  /** How long after a swipe a tap is still treated as part of that swipe. */
  static readonly tapBlackoutMs = 350;

  private dragging = false;
  private endedAt: number | null = null;

  begin(): void {
    this.dragging = true;
    this.endedAt = null;
  }

  end(at: number = Date.now()): void {
    this.dragging = false;
    this.endedAt = at;
  }

  isSuppressingTaps(at: number = Date.now()): boolean {
    if (this.dragging) return true;
    if (this.endedAt === null) return false;
    return at - this.endedAt < PagerDragState.tapBlackoutMs;
  }
}
