import bundledRotationJSON from '../../assets/data/EngineeringLabRotation.json';
import engineeringYear1JSON from '../../assets/data/EngineeringYear1.json';
import lecturersJSON from '../../assets/data/lecturers.json';
import { LecturerDirectory } from '../core/misc';
import { parseActivityCode } from '../core/activityCode';
import {
  cohortCourseKey, labSessionID, LabRotation, LabRotations, LabSession, StudentProfile,
} from '../core/profile';
import { DublinTime } from '../core/time';
import {
  restoreEvent, StoredEvent, storeEvent, TeachingWeek, TimetableCategory, TimetableEvent, WeekCalendar,
} from '../core/timetableEvent';
import { LabRotationCache } from './courseData';
import { DCUAPIClient, TimetableSource } from './dcuApi';
import { AsyncKV } from './storage';

// MARK: - Bundled data

/** The rotation shipped with the app (no personal data). */
export function bundledRotation(): LabRotation | null {
  return LabRotations.decode(bundledRotationJSON);
}

/** The Year-1 Engineering module set (codes only). */
export function engineeringYear1Modules(): string[] {
  const modules = (engineeringYear1JSON as { modules?: unknown }).modules;
  return Array.isArray(modules) ? modules.filter((m): m is string => typeof m === 'string') : [];
}

/** Staff photos and roles, for anyone listed in `assets/data/lecturers.json`. */
export const lecturerDirectory = new LecturerDirectory(lecturersJSON);

/** The course every rotation here belongs to, until a second one has a rotation. */
export const ROTATION_COURSE_KEY = cohortCourseKey('engineeringYear1');

/** What the app shows: the rotation last downloaded from the console, else the bundled one. */
export function currentRotation(cache: LabRotationCache): LabRotation | null {
  return cache.entry(ROTATION_COURSE_KEY)?.rotation ?? bundledRotation();
}

// MARK: - A profile's timetable

/**
 * Builds a Year-1 Engineering student's personal timetable: the shared EEG module set, with
 * the generic lab slots replaced by the student's own lab rotation (by group).
 */
export class ProfileTimetableSource implements TimetableSource {
  private readonly moduleCodes = engineeringYear1Modules();

  constructor(
    private readonly profile: StudentProfile,
    private readonly rotationCache: LabRotationCache,
    private readonly client: DCUAPIClient = new DCUAPIClient(),
  ) {}

  async searchProgrammes(): Promise<TimetableCategory[]> {
    return [];
  }

  weekCalendar(): Promise<WeekCalendar> {
    return this.client.weekCalendar();
  }

  async events(_category: TimetableCategory, weeks: TeachingWeek[]): Promise<TimetableEvent[]> {
    let events = await this.client.eventsForModuleCodes(this.moduleCodes, weeks);

    // Read per load: a rotation corrected in the console replaces the cached one while this
    // source is alive, and the reload that follows must see it.
    const rotation = currentRotation(this.rotationCache);
    if (rotation) {
      // Drop the generic lab slots for the rotation modules — the student's real labs come
      // from their group's rotation, not the all-groups timetable slot.
      const rotationModules = LabRotations.moduleCodes(rotation);
      events = events.filter((e) => !(rotationModules.has(e.activity.moduleCode ?? '') && e.activity.kind === 'P'));
      const wanted = new Set(weeks.map((w) => w.number));
      const sessions = LabRotations.sessionsForGroup(rotation, this.profile.group).filter((s) => wanted.has(s.week));
      for (const session of sessions) {
        const event = this.rotationEvent(session, rotation);
        if (event) events.push(event);
      }
    }
    return events.sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  /** The rotation PDF's times are Irish clock times, so the dates are built in Dublin time. */
  private rotationEvent(session: LabSession, rotation: LabRotation): TimetableEvent | null {
    const start = DublinTime.date(session.date, session.start);
    const end = DublinTime.date(session.date, session.end);
    if (!start || !end) return null;

    const activity = session.activity;
    const lower = activity.toLowerCase();
    let room: string[] = [];
    if (lower.includes('workshop')) room = this.profile.workshop ? [this.profile.workshop] : [];
    else if (lower.includes('drawing')) room = this.profile.drawing ? [this.profile.drawing] : [];

    const moduleName = LabRotations.name(rotation, session.module);
    return {
      id: `rotation-${labSessionID(session)}`,
      start,
      end,
      type: 'onCampus',
      locations: room,
      moduleName: activity ? `${activity} · ${moduleName}` : moduleName,
      staff: [],
      activity: parseActivityCode(session.module),
      weekLabels: [String(session.week)],
    };
  }
}

// MARK: - Offline copy

/** A cached timetable for one programme + week, for offline-first loading. */
export interface TimetableSnapshot {
  categoryID: string;
  weekNumber: number;
  events: TimetableEvent[];
  fetchedAt: Date;
}

/**
 * The last fetched copy of each week: read immediately, refreshed behind it. Read on demand
 * rather than at launch, since a whole year of weeks is more than launch should wait for.
 */
export class TimetableCache {
  constructor(private readonly kv: AsyncKV, private readonly prefix = 'cache:timetable:') {}

  private key(categoryID: string, weekNumber: number): string {
    return `${this.prefix}${categoryID.replace(/\//g, '_')}-w${weekNumber}`;
  }

  async snapshot(categoryID: string, weekNumber: number): Promise<TimetableSnapshot | null> {
    try {
      const raw = await this.kv.getItem(this.key(categoryID, weekNumber));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { events: StoredEvent[]; fetchedAt: string };
      return {
        categoryID,
        weekNumber,
        events: parsed.events.map(restoreEvent),
        fetchedAt: new Date(parsed.fetchedAt),
      };
    } catch {
      return null;
    }
  }

  async store(snapshot: TimetableSnapshot): Promise<void> {
    try {
      await this.kv.setItem(
        this.key(snapshot.categoryID, snapshot.weekNumber),
        JSON.stringify({ events: snapshot.events.map(storeEvent), fetchedAt: snapshot.fetchedAt.toISOString() }),
      );
    } catch {
      // A full disk costs the offline copy, not the timetable on screen.
    }
  }
}
