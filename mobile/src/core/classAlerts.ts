import { locationDisplay } from './roomLocation';
import { formatTime } from './time';
import { eventTypeLabel, shortTitleOf, TimetableEvent } from './timetableEvent';

/**
 * Class alerts, as Calendar does its default alert times: each class alerts a set time
 * before it starts, with an optional second alert. The phone schedules them, so they fire
 * with no signal — but only for the classes the app has loaded (this week and the next).
 */

/** Minutes before the class; 0 is "at the start". Null is no alert. */
export type AlertOffset = number | null;

export interface AlertSettings {
  first: AlertOffset;
  second: AlertOffset;
}

export interface PlannedAlert {
  /** Stable across plans, so an unchanged alert is recognisably the same one. */
  id: string;
  eventID: string;
  fireAt: Date;
  title: string;
  body: string;
}

export const ClassAlerts = {
  defaults: { first: 15, second: null } as AlertSettings,

  /** Calendar's list, stopping where an alert stops being about getting to a class. */
  options: [null, 0, 5, 10, 15, 30, 60, 120] as AlertOffset[],

  /**
   * iOS keeps at most 64 pending notifications per app and drops the rest. Leave headroom
   * rather than let it choose which classes lose their alert.
   */
  limit: 60,

  label(offset: AlertOffset): string {
    if (offset === null) return 'None';
    if (offset === 0) return 'At start of class';
    if (offset < 60) return `${offset} minutes before`;
    const hours = offset / 60;
    return hours === 1 ? '1 hour before' : `${hours} hours before`;
  },

  /** Saved settings, read defensively: anything unrecognised falls back to the default. */
  settings(saved: unknown): AlertSettings {
    const valid = (value: unknown, fallback: AlertOffset): AlertOffset =>
      value === null || (typeof value === 'number' && ClassAlerts.options.includes(value)) ? value : fallback;
    const s = (saved ?? {}) as Partial<Record<keyof AlertSettings, unknown>>;
    return {
      first: valid(s.first, ClassAlerts.defaults.first),
      second: valid(s.second, ClassAlerts.defaults.second),
    };
  },

  /**
   * Every alert still to fire, soonest first, up to `limit`. A class the student won't be at
   * — marked not attending, or reported cancelled — doesn't alert. The same time chosen twice
   * alerts once.
   */
  plan(events: TimetableEvent[], settings: AlertSettings, now: Date, isOff: (event: TimetableEvent) => boolean): PlannedAlert[] {
    const offsets = [...new Set([settings.first, settings.second].filter((o): o is number => o !== null))];
    if (offsets.length === 0) return [];
    const seen = new Set<string>();
    const alerts: PlannedAlert[] = [];
    for (const event of events) {
      if (seen.has(event.id) || isOff(event)) continue;
      seen.add(event.id);
      for (const offset of offsets) {
        const fireAt = new Date(event.start.getTime() - offset * 60_000);
        if (fireAt <= now) continue;
        alerts.push({
          id: `${event.id}@${offset}`,
          eventID: event.id,
          fireAt,
          title: shortTitleOf(event),
          body: ClassAlerts.body(event, offset),
        });
      }
    }
    alerts.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime() || a.id.localeCompare(b.id));
    return alerts.slice(0, ClassAlerts.limit);
  },

  /** "In 15 minutes · 10:00–11:00 · Henry Grattan, Room 114" — when, then where. */
  body(event: TimetableEvent, offset: number): string {
    const when = offset === 0 ? 'Starting now' : `In ${ClassAlerts.label(offset).replace(' before', '')}`;
    const room = locationDisplay(event) === '—' ? null : locationDisplay(event);
    const delivery = event.type === 'onCampus' ? null : eventTypeLabel(event.type);
    const place = [room, delivery].filter((p): p is string => p !== null).join(', ');
    return [when, `${formatTime(event.start)}–${formatTime(event.end)}`, place].filter((p) => p !== '').join(' · ');
  },
};
