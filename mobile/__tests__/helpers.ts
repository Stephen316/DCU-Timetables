import { parseActivityCode } from '../src/core/activityCode';
import { EventType, TimetableEvent } from '../src/core/timetableEvent';

/** A class with only what a test needs to say about it. */
export function event(
  code: string,
  start: Date,
  end: Date = new Date(start.getTime() + 3600_000),
  fields: { id?: string; locations?: string[]; moduleName?: string | null; type?: EventType } = {},
): TimetableEvent {
  return {
    id: fields.id ?? `${code}-${start.getTime()}-${Math.random()}`,
    start,
    end,
    type: fields.type ?? 'onCampus',
    locations: fields.locations ?? [],
    moduleName: fields.moduleName ?? null,
    staff: [],
    activity: parseActivityCode(code),
    weekLabels: [],
  };
}

/** A wall-clock time in the test time zone (Europe/Dublin — see jest.global-setup.js). */
export function at(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute);
}

/** A UTC instant. */
export function utc(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute));
}
