import {
  Allocation, allocationFromRow, changeFromRow, cohortForCourseKey, LabRotation, LabRotations, LabSession,
  profileFromAllocation, StudentProfile, TimetableChange,
} from '../core/profile';
import { rows, SupabaseREST } from './rest';
import { PrefKey, Prefs } from './storage';

const describe = (status: number) => `The server returned ${status}.`;

// MARK: - Class lists

/** A class list an admin has uploaded. Title and version only; the list stays on the server. */
export interface RosterSummary {
  courseKey: string;
  title: string | null;
  version: number;
}

/** What `resolve_allocation` said about the signed-in student. */
export type AllocationResolution =
  /** Exactly one row. `key` is hex, as the RPC returns it. */
  | { kind: 'matched'; key: string; version: number }
  /** Several students share this name; ask which subgroup and call again. */
  | { kind: 'ambiguous' }
  /** Not on this class list. */
  | { kind: 'notListed' }
  /** The name and the student ID point different ways; flagged for an admin. */
  | { kind: 'conflict' }
  /** Nothing has been uploaded for this course. */
  | { kind: 'noRoster' };

/**
 * Decodes the RPC's one-row table. An unknown status reads as "not listed" — the one answer
 * that never shows a student somebody else's labs.
 */
export function decodeResolution(json: unknown): AllocationResolution {
  const row = rows(json)[0];
  if (!row) return { kind: 'notListed' };
  switch (row.status) {
    case 'matched':
      if (typeof row.allocation_key !== 'string' || typeof row.version !== 'number') return { kind: 'notListed' };
      return { kind: 'matched', key: row.allocation_key, version: row.version };
    case 'ambiguous': return { kind: 'ambiguous' };
    case 'conflict': return { kind: 'conflict' };
    case 'no_roster': return { kind: 'noRoster' };
    default: return { kind: 'notListed' };
  }
}

export interface AllocationStore {
  /** Every class list that has been uploaded. */
  rosters(): Promise<RosterSummary[]>;
  /** Matches the signed-in account on the server, from its verified address. */
  resolve(courseKey: string, subgroup: string | null): Promise<AllocationResolution>;
  /** The one allocation row for a resolved key. */
  allocation(courseKey: string, key: string): Promise<Allocation | null>;
  /** The subgroups on a course's list, to ask a student with a shared name which is theirs. */
  subgroups(courseKey: string): Promise<string[]>;
}

export class SupabaseAllocationStore implements AllocationStore {
  constructor(private readonly rest: SupabaseREST) {}

  async rosters(): Promise<RosterSummary[]> {
    const json = await this.rest.json('GET', '/rest/v1/rosters', describe, {
      query: [['select', 'course_key,title,version']],
    });
    return rows(json).flatMap((r) =>
      typeof r.course_key === 'string' && typeof r.version === 'number'
        ? [{ courseKey: r.course_key, title: typeof r.title === 'string' ? r.title : null, version: r.version }]
        : [],
    );
  }

  async resolve(courseKey: string, subgroup: string | null): Promise<AllocationResolution> {
    const body: Record<string, string> = { p_course_key: courseKey };
    if (subgroup !== null) body.p_subgroup = subgroup;
    return decodeResolution(await this.rest.json('POST', '/rest/v1/rpc/resolve_allocation', describe, { body }));
  }

  async allocation(courseKey: string, key: string): Promise<Allocation | null> {
    const json = await this.rest.json('GET', '/rest/v1/course_allocations', describe, {
      query: [
        ['select', 'grp,subgroup,day,workshop,drawing'],
        ['course_key', `eq.${courseKey}`],
        // PostgREST reads a bytea literal as \x followed by hex.
        ['allocation_key', `eq.\\x${key}`],
      ],
    });
    const row = rows(json)[0];
    return row ? allocationFromRow(row) : null;
  }

  async subgroups(courseKey: string): Promise<string[]> {
    const json = await this.rest.json('GET', '/rest/v1/course_allocations', describe, {
      query: [['select', 'subgroup'], ['course_key', `eq.${courseKey}`]],
    });
    const set = new Set(rows(json).flatMap((r) => (typeof r.subgroup === 'string' ? [r.subgroup] : [])));
    return [...set].sort();
  }
}

/**
 * Keeps a saved profile in step with the class list it came from. An admin re-uploading a
 * corrected list bumps its version, and a profile made from the old one is resolved again.
 */
export const AllocationRefresh = {
  async check(
    profile: StudentProfile,
    store: AllocationStore,
  ): Promise<{ kind: 'unchanged' } | { kind: 'updated'; profile: StudentProfile } | { kind: 'dropped' }> {
    const { courseKey, rosterVersion: version } = profile;
    if (courseKey === null || version === null) return { kind: 'unchanged' };
    try {
      const current = (await store.rosters()).find((r) => r.courseKey === courseKey);
      if (!current) return { kind: 'dropped' };
      if (current.version === version) return { kind: 'unchanged' };

      const resolution = await store.resolve(courseKey, profile.subgroup === '' ? null : profile.subgroup);
      if (resolution.kind !== 'matched') return { kind: 'dropped' };
      const allocation = await store.allocation(courseKey, resolution.key);
      if (!allocation) return { kind: 'unchanged' };
      return {
        kind: 'updated',
        profile: profileFromAllocation(profile.name, profile.cohort, allocation, resolution.key, resolution.version),
      };
    } catch {
      // A network failure keeps the profile that works rather than dropping it.
      return { kind: 'unchanged' };
    }
  },

  /**
   * For a student who picked a programme because no list had them. Each list is asked about
   * once per version: a conflict files a flag for an admin on every call. A shared name comes
   * back ambiguous and stays — the subgroup question belongs on the profile screen.
   */
  async adopt(
    name: string,
    tried: Record<string, number>,
    store: AllocationStore,
  ): Promise<{ kind: 'adopted'; profile: StudentProfile } | { kind: 'stay'; tried: Record<string, number> }> {
    const next = { ...tried };
    try {
      const fresh = (await store.rosters())
        .filter((r) => cohortForCourseKey(r.courseKey) !== null && next[r.courseKey] !== r.version)
        .sort((a, b) => (a.courseKey < b.courseKey ? -1 : a.courseKey > b.courseKey ? 1 : 0));
      for (const roster of fresh) {
        const cohort = cohortForCourseKey(roster.courseKey);
        if (cohort === null) continue;
        const resolution = await store.resolve(roster.courseKey, null);
        if (resolution.kind === 'matched') {
          const allocation = await store.allocation(roster.courseKey, resolution.key);
          if (allocation) {
            return {
              kind: 'adopted',
              profile: profileFromAllocation(name, cohort, allocation, resolution.key, resolution.version),
            };
          }
        }
        next[roster.courseKey] = roster.version;
      }
    } catch {
      // Offline: whatever was asked about before the failure stays asked; the rest next time.
    }
    return { kind: 'stay', tried: next };
  },
};

// MARK: - Lab rotation

export interface SavedLabRotation {
  version: number;
  title: string | null;
  sessions: LabSession[];
}

/**
 * Decodes PostgREST's one-row embed. A session missing its date, times, module, week or
 * groups can't be placed on a day, so it is left out rather than guessed at.
 */
export function decodeSavedRotation(json: unknown): SavedLabRotation | null {
  const row = rows(json)[0];
  if (!row || typeof row.version !== 'number') return null;
  const sessions = rows(row.lab_rotation_sessions).flatMap((s): LabSession[] => {
    if (
      typeof s.week !== 'number' || typeof s.date !== 'string' || typeof s.start_time !== 'string' ||
      typeof s.end_time !== 'string' || typeof s.module !== 'string' || !Array.isArray(s.groups) || s.groups.length === 0
    ) {
      return [];
    }
    return [{
      week: s.week,
      date: s.date,
      day: typeof s.day === 'string' ? s.day : '',
      start: s.start_time,
      end: s.end_time,
      module: s.module,
      // Rotations saved before phase 12 have no activity. Left empty rather than invented.
      activity: typeof s.activity === 'string' ? s.activity : '',
      groups: s.groups.filter((g): g is string => typeof g === 'string'),
    }];
  });
  return { version: row.version, title: typeof row.title === 'string' ? row.title : null, sessions };
}

/** The lab rotation as saved in the console (`lab_rotations`), so corrections reach phones. */
export interface LabRotationStore {
  /** The saved rotation's version, or null when nothing is saved for the course. */
  version(courseKey: string): Promise<number | null>;
  rotation(courseKey: string): Promise<SavedLabRotation | null>;
}

export class SupabaseLabRotationStore implements LabRotationStore {
  constructor(private readonly rest: SupabaseREST) {}

  async version(courseKey: string): Promise<number | null> {
    const row = rows(await this.get(courseKey, 'version'))[0];
    return typeof row?.version === 'number' ? row.version : null;
  }

  async rotation(courseKey: string): Promise<SavedLabRotation | null> {
    return decodeSavedRotation(
      await this.get(courseKey, 'version,title,lab_rotation_sessions(week,date,day,start_time,end_time,module,activity,groups)'),
    );
  }

  private get(courseKey: string, select: string): Promise<unknown> {
    return this.rest.json('GET', '/rest/v1/lab_rotations', describe, {
      auth: 'userOnly',
      query: [['select', select], ['course_key', `eq.${courseKey}`]],
    });
  }
}

/** The last rotation downloaded, so it survives a relaunch with no signal. */
export class LabRotationCache {
  constructor(private readonly prefs: Prefs) {}

  entry(courseKey: string): { version: number; rotation: LabRotation } | null {
    const raw = this.prefs.getJSON<{ version?: unknown; rotation?: unknown } | null>(PrefKey.labRotation(courseKey), null);
    if (!raw || typeof raw.version !== 'number') return null;
    const rotation = LabRotations.decode(raw.rotation);
    return rotation ? { version: raw.version, rotation } : null;
  }

  store(entry: { version: number; rotation: LabRotation }, courseKey: string): void {
    this.prefs.setJSON(PrefKey.labRotation(courseKey), entry);
  }

  remove(courseKey: string): void {
    this.prefs.set(PrefKey.labRotation(courseKey), null);
  }
}

export const LabRotationRefresh = {
  /**
   * Brings the cached rotation in step with the console. True when what the app shows has
   * changed. A failure of any kind keeps what is cached: offline must not swap a corrected
   * rotation back to the bundled one.
   */
  async run(courseKey: string, store: LabRotationStore, cache: LabRotationCache, bundled: LabRotation | null): Promise<boolean> {
    const cached = cache.entry(courseKey);
    let version: number | null;
    try {
      version = await store.version(courseKey);
    } catch {
      return false;
    }
    if (version === null) {
      // Deleted in the console: back to the bundled copy.
      if (cached === null) return false;
      cache.remove(courseKey);
      return true;
    }
    if (cached?.version === version) return false;
    let saved: SavedLabRotation | null;
    try {
      saved = await store.rotation(courseKey);
    } catch {
      return false;
    }
    if (!saved || saved.sessions.length === 0) return false;
    cache.store({ version: saved.version, rotation: LabRotationRefresh.merge(saved, bundled) }, courseKey);
    return true;
  },

  /** The console saves sessions, not module titles. Titles come from the bundled file. */
  merge(saved: SavedLabRotation, bundled: LabRotation | null): LabRotation {
    const modules: Record<string, { name: string }> = {};
    for (const code of new Set(saved.sessions.map((s) => s.module))) {
      modules[code] = bundled?.modules[code] ?? { name: code };
    }
    return { title: saved.title ?? bundled?.title ?? 'Lab rotation', modules, sessions: saved.sessions };
  },
};

// MARK: - Timetable changes

/** The timetable changes saved in the console for a course (`timetable_changes`). */
export interface TimetableChangeStore {
  changes(courseKey: string): Promise<TimetableChange[]>;
}

export class SupabaseTimetableChangeStore implements TimetableChangeStore {
  constructor(private readonly rest: SupabaseREST) {}

  async changes(courseKey: string): Promise<TimetableChange[]> {
    // Signed in or not at all: the anon key reads an empty table, which would wipe the cache.
    const json = await this.rest.json('GET', '/rest/v1/timetable_changes', describe, {
      auth: 'userOnly',
      query: [
        ['select', 'id,course_key,grp,kind,module,activity_code,title,dates,start_time,end_time,room'],
        ['course_key', `eq.${courseKey}`],
        ['order', 'created_at'],
      ],
    });
    return rows(json).flatMap((r) => {
      const change = changeFromRow(r);
      return change ? [change] : [];
    });
  }
}

/** The last changes downloaded per course, so they hold with no signal. */
export class TimetableChangeCache {
  constructor(private readonly prefs: Prefs) {}

  changes(courseKey: string): TimetableChange[] {
    return this.prefs.getJSON<TimetableChange[]>(PrefKey.timetableChanges(courseKey), []);
  }

  store(changes: TimetableChange[], courseKey: string): void {
    this.prefs.setJSON(PrefKey.timetableChanges(courseKey), changes);
  }
}

export const TimetableChangeRefresh = {
  /**
   * True when the course's changes differ from what is cached. A failed request keeps the
   * cache: offline must not bring back a class that was removed.
   */
  async run(courseKey: string, store: TimetableChangeStore, cache: TimetableChangeCache): Promise<boolean> {
    let fresh: TimetableChange[];
    try {
      fresh = await store.changes(courseKey);
    } catch {
      return false;
    }
    if (JSON.stringify(fresh) === JSON.stringify(cache.changes(courseKey))) return false;
    cache.store(fresh, courseKey);
    return true;
  },
};
