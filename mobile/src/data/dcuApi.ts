import { parseActivityCode } from '../core/activityCode';
import {
  CategoryType, eventTypeFromAPI, TeachingWeek, TimetableCategory, TimetableEvent, WeekCalendar,
} from '../core/timetableEvent';
import { isoSeconds, parseISO, DAY } from '../core/time';
import { uuid } from '../core/uuid';
import { buildQuery, userFacing } from './rest';
import { PrefKey, Prefs } from './storage';

/**
 * The seam between the app and wherever timetable data comes from. The live DCU JSON API is
 * one implementation; the student's profile timetable and the preview fixtures are others.
 */
export interface TimetableSource {
  /** Search programmes of study by free text (paged). */
  searchProgrammes(query: string, page?: number): Promise<TimetableCategory[]>;
  /** The institution's week calendar for the current academic year. */
  weekCalendar(): Promise<WeekCalendar>;
  /** All events for a category (programme/module/room) across the given weeks. */
  events(category: TimetableCategory, weeks: TeachingWeek[]): Promise<TimetableEvent[]>;
  /**
   * The course's classes that `events` leaves out because they're another group's — what the
   * student can add from Edit timetable. Absent when the source keeps nothing back.
   */
  otherEvents?(category: TimetableCategory, weeks: TeachingWeek[]): Promise<TimetableEvent[]>;
}

export const TimetableSourceError = {
  http: (status: number) => userFacing(`The timetable service returned an error (${status}).`),
  decoding: (detail: string) => userFacing(`Couldn't read the timetable data. ${detail}`),
};

// MARK: - Wire format (see docs/API.md). PascalCase keys, as the API sends them.

interface WeekDTO { WeekNumber: number; WeekLabel: string; FirstDayInWeek: string }
interface DayDTO { Name: string; DayOfWeek: number; IsDefault?: boolean | null }
interface ViewOptionsDTO { Weeks: WeekDTO[]; Days: DayDTO[] }
interface ExtraPropertyDTO { Name?: string | null; Value?: string | null }
export interface EventDTO {
  Identity?: string | null;
  StartDateTime?: string | null;
  EndDateTime?: string | null;
  EventType?: string | null;
  Location?: string | null;
  Description?: string | null;
  Name?: string | null;
  /** e.g. "2" or "1,3,5" — a string, not an array. */
  WeekLabels?: string | null;
  ExtraProperties?: ExtraPropertyDTO[] | null;
}
export interface EventsResponseDTO {
  CategoryEvents?: { Identity?: string | null; Name?: string | null; Results?: EventDTO[] | null }[] | null;
}

function isViewOptions(value: unknown): value is ViewOptionsDTO {
  const v = value as ViewOptionsDTO;
  return (
    typeof v === 'object' && v !== null && Array.isArray(v.Weeks) && Array.isArray(v.Days) &&
    v.Weeks.every((w) => typeof w?.WeekNumber === 'number' && typeof w.WeekLabel === 'string' && typeof w.FirstDayInWeek === 'string') &&
    v.Days.every((d) => typeof d?.Name === 'string' && typeof d.DayOfWeek === 'number')
  );
}

// MARK: - Mapping

/** Converts API event DTOs into the Core `TimetableEvent` type. */
export const EventMapper = {
  event(dto: EventDTO): TimetableEvent | null {
    const start = parseISO(dto.StartDateTime);
    const end = parseISO(dto.EndDateTime);
    if (!start || !end) return null;
    const extras = new Map<string, string>();
    for (const p of dto.ExtraProperties ?? []) {
      if (typeof p?.Name === 'string' && typeof p.Value === 'string' && !extras.has(p.Name)) extras.set(p.Name, p.Value);
    }
    const moduleName = nonEmpty(extras.get('Module Name'));
    const staff = nonEmpty(extras.get('Staff Member'));
    return {
      id: dto.Identity ?? uuid(),
      start,
      end,
      type: eventTypeFromAPI(dto.EventType),
      locations: EventMapper.locations(dto.Location),
      moduleName,
      staff: staff !== null ? [staff] : [],
      activity: parseActivityCode(dto.Name ?? ''),
      weekLabels: EventMapper.weekLabels(dto.WeekLabels),
    };
  },

  events(response: EventsResponseDTO): TimetableEvent[] {
    return (response.CategoryEvents ?? [])
      .flatMap((group) => group?.Results ?? [])
      .flatMap((dto) => {
        const event = EventMapper.event(dto);
        return event ? [event] : [];
      })
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  },

  locations(raw: string | null | undefined): string[] {
    if (!raw) return [];
    return raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  },

  weekLabels(raw: string | null | undefined): string[] {
    if (!raw) return [];
    return raw.split(/[,;]/).map((s) => s.trim()).filter((s) => s.length > 0);
  },
};

function nonEmpty(s: string | undefined): string | null {
  return s !== undefined && s.trim().length > 0 ? s : null;
}

// MARK: - Client

export interface DCUAPIConfig {
  apiBase: string;
  institutionID: string;
}

/**
 * Verified values for DCU (2026-09-15). The host is versioned and read from the web app at
 * runtime — see docs/API.md; long-term it should be re-derived, not pinned here.
 */
export const DCU_API: DCUAPIConfig = {
  apiBase: 'https://scientia-eu-v4-api-d1-03.azurewebsites.net/api',
  institutionID: 'a1fdee6b-68eb-47b8-b2ac-a4c60c8e6177',
};

/** The module ids looked up for one academic year, kept so the next load needn't ask again. */
export interface SavedModuleIdentities {
  /** `academicYear` of the week calendar they were found in. */
  year: string;
  /** Milliseconds since 1970: they're looked up afresh once they're `MODULE_IDENTITY_MAX_AGE_MS` old. */
  savedAt: number;
  ids: Record<string, string>;
}

/**
 * How long a looked-up module id is trusted. They don't change within a year, but if DCU
 * ever remade one, a wrong id would quietly empty that module from every week, so a stale
 * one is looked up again rather than kept for good.
 */
export const MODULE_IDENTITY_MAX_AGE_MS = 14 * DAY;

/** How long one answer for the week calendar is reused before it's asked for again. */
const VIEW_OPTIONS_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** The year a calendar is for, told by its first week's Monday: a new year means new module ids. */
function academicYear(vo: ViewOptionsDTO): string {
  return vo.Weeks.map((w) => w.FirstDayInWeek).sort()[0] ?? '';
}

/** Live client for DCU's public MyTimetable v4 API (anonymous guest access). */
export class DCUAPIClient implements TimetableSource {
  /**
   * The week calendar, asked for once and shared: every week's events request needs it, and
   * so does the calendar itself, so without this each week cost a request more.
   */
  private viewOptionsAsked: { at: number; answer: Promise<ViewOptionsDTO> } | null = null;

  constructor(
    private readonly config: DCUAPIConfig = DCU_API,
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
    /** Where looked-up module ids are kept between launches. Left out, they last the session. */
    private readonly prefs: Prefs | null = null,
  ) {}

  /** Module ids found this session, when there's nowhere to keep them. */
  private sessionIdentities: SavedModuleIdentities | null = null;

  searchProgrammes(query: string, page = 1): Promise<TimetableCategory[]> {
    return this.searchCategories(CategoryType.programme, query, page);
  }

  /**
   * The search term goes in the URL query string — the endpoint ignores a body `query` and
   * pages through everything. The body is the (empty) parent-filter list.
   */
  private async searchCategories(type: string, query: string, page: number): Promise<TimetableCategory[]> {
    const path = `Public/CategoryTypes/${type}/Categories/FilterWithCache/${this.config.institutionID}`;
    const params = buildQuery([
      ['query', query],
      ['itemsPerPage', '50'],
      ['pageNumber', String(page)],
      ['returnOccurrences', 'false'],
    ]);
    const response = (await this.send('POST', `${path}?${params}`, [])) as { Results?: unknown };
    if (!Array.isArray(response?.Results)) throw TimetableSourceError.decoding('No results list.');
    return (response.Results as Record<string, unknown>[]).flatMap((r) =>
      typeof r?.Identity === 'string' && typeof r.Name === 'string'
        ? [{
            identity: r.Identity,
            name: r.Name,
            categoryTypeIdentity: typeof r.CategoryTypeIdentity === 'string' ? r.CategoryTypeIdentity : type,
          }]
        : [],
    );
  }

  async weekCalendar(): Promise<WeekCalendar> {
    const vo = await this.viewOptions();
    const weeks = vo.Weeks.flatMap((w) => {
      const firstDay = parseISO(w.FirstDayInWeek);
      return firstDay ? [{ number: w.WeekNumber, label: w.WeekLabel, firstDay }] : [];
    });
    return new WeekCalendar(weeks, vo.Days.map((d) => ({ name: d.Name, dayOfWeek: d.DayOfWeek })));
  }

  events(category: TimetableCategory, weeks: TeachingWeek[]): Promise<TimetableEvent[]> {
    return this.fetchEvents(category.categoryTypeIdentity, [category.identity], weeks);
  }

  /** Combined events for a set of module codes — a cohort timetable built from modules. */
  async eventsForModuleCodes(codes: string[], weeks: TeachingWeek[]): Promise<TimetableEvent[]> {
    const identities = await this.moduleIdentities(codes);
    return this.fetchEvents(CategoryType.module, identities, weeks);
  }

  /**
   * Each code's id, in the order given: the ones found before from this year's store, and
   * any missing looked up all at once rather than one after another. A code with no match
   * is left out, and looked up again next time.
   */
  private async moduleIdentities(codes: string[]): Promise<string[]> {
    const year = academicYear(await this.viewOptions());
    const now = Date.now();
    const stored = this.storedIdentities();
    const saved = stored && stored.year === year && now - stored.savedAt < MODULE_IDENTITY_MAX_AGE_MS
      ? stored
      : { year, savedAt: now, ids: {} };
    const missing = codes.filter((code) => !(code in saved.ids));
    if (missing.length > 0) {
      const found = await Promise.all(missing.map(async (code) => [code, await this.moduleIdentity(code)] as const));
      const ids = { ...saved.ids };
      for (const [code, id] of found) if (id !== null) ids[code] = id;
      this.storeIdentities({ ...saved, ids });
      saved.ids = ids;
    }
    return codes.flatMap((code) => (saved.ids[code] !== undefined ? [saved.ids[code]] : []));
  }

  private storedIdentities(): SavedModuleIdentities | null {
    if (!this.prefs) return this.sessionIdentities;
    const value = this.prefs.getJSON<SavedModuleIdentities | null>(PrefKey.moduleIdentities, null);
    return value && typeof value.year === 'string' && typeof value.savedAt === 'number' && typeof value.ids === 'object' && value.ids !== null
      ? value
      : null;
  }

  private storeIdentities(saved: SavedModuleIdentities): void {
    if (this.prefs) this.prefs.setJSON(PrefKey.moduleIdentities, saved);
    else this.sessionIdentities = saved;
  }

  /** Resolve a module code (e.g. "EEG1001") to its category identity. */
  private async moduleIdentity(code: string): Promise<string | null> {
    const matches = await this.searchCategories(CategoryType.module, code, 1);
    const exact = matches.find((m) => m.name.toUpperCase().startsWith(code.toUpperCase()));
    return (exact ?? matches[0])?.identity ?? null;
  }

  private async fetchEvents(typeIdentity: string, categoryIdentities: string[], weeks: TeachingWeek[]): Promise<TimetableEvent[]> {
    if (categoryIdentities.length === 0) return [];
    const vo = await this.viewOptions();
    const wanted = new Set(weeks.map((w) => w.number));
    const weekDTOs = vo.Weeks.filter((w) => wanted.has(w.WeekNumber)).sort((a, b) => a.WeekNumber - b.WeekNumber);
    if (weekDTOs.length === 0) return [];

    // The complete ViewOptions the events endpoint requires — omitting Days, TimePeriods or
    // DatePeriods yields an empty result (see docs/API.md).
    const lastStart = parseISO(weekDTOs[weekDTOs.length - 1].FirstDayInWeek) ?? new Date();
    const body = {
      ViewOptions: {
        Days: vo.Days.map((d) => (d.IsDefault == null ? { Name: d.Name, DayOfWeek: d.DayOfWeek } : { Name: d.Name, DayOfWeek: d.DayOfWeek, IsDefault: d.IsDefault })),
        Weeks: weekDTOs.map((w) => ({ WeekNumber: w.WeekNumber, WeekLabel: w.WeekLabel, FirstDayInWeek: w.FirstDayInWeek })),
        TimePeriods: [{ Description: 'All Day', StartTime: '00:00', EndTime: '23:59', IsDefault: true }],
        DatePeriods: [{
          Description: 'Range',
          StartDateTime: weekDTOs[0].FirstDayInWeek,
          EndDateTime: isoSeconds(new Date(lastStart.getTime() + 7 * DAY)),
          IsDefault: true,
        }],
      },
      CategoryTypesWithIdentities: [{ CategoryTypeIdentity: typeIdentity, CategoryIdentities: categoryIdentities }],
      FetchBookings: false,
      FetchPersonalEvents: false,
      PersonalIdentities: [],
    };
    const response = await this.send('POST', `Public/CategoryTypes/Categories/Events/Filter/${this.config.institutionID}`, body);
    return EventMapper.events((response ?? {}) as EventsResponseDTO);
  }

  private viewOptions(): Promise<ViewOptionsDTO> {
    const now = Date.now();
    const asked = this.viewOptionsAsked;
    if (asked && now - asked.at < VIEW_OPTIONS_MAX_AGE_MS) return asked.answer;
    const answer = this.send('GET', `Public/ViewOptions/${this.config.institutionID}`).then((vo) => {
      if (!isViewOptions(vo)) throw TimetableSourceError.decoding('Unexpected week calendar.');
      return vo;
    });
    this.viewOptionsAsked = { at: now, answer };
    // A failure isn't kept: the next request asks again.
    answer.catch(() => {
      if (this.viewOptionsAsked?.answer === answer) this.viewOptionsAsked = null;
    });
    return answer;
  }

  private async send(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    const headers: Record<string, string> = {
      Authorization: 'Anonymous',
      Accept: 'application/json',
      Origin: 'https://mytimetable.dcu.ie',
      Referer: 'https://mytimetable.dcu.ie/',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await this.fetchFn(`${this.config.apiBase}/${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) throw TimetableSourceError.http(response.status);
    try {
      return await response.json();
    } catch (error) {
      throw TimetableSourceError.decoding(String(error));
    }
  }
}
