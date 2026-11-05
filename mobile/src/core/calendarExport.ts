import { activitySummary } from './activityCode';
import { AlertSettings } from './classAlerts';
import { locationDisplay } from './roomLocation';
import { eventTypeLabel, shortTitleOf, staffText, TimetableEvent, titleOf } from './timetableEvent';

/**
 * One class as a calendar has it, whichever way it gets there: the .ics file or Google.
 * Both are built from these, so the two can never word a class differently.
 */
export interface CalendarEntry {
  /** Stable across exports, so adding the year again updates a class rather than doubling it. */
  uid: string;
  start: Date;
  end: Date;
  title: string;
  /** Room and delivery, "" when there's neither. */
  place: string;
  /** The module's full title, the activity and the staff, one to a line; "" when there's none. */
  notes: string;
  /** Minutes before the start for each alert, fewest first; 0 is at the start. */
  alerts: number[];
}

/**
 * The timetable as an iCalendar file (RFC 5545), for Calendar, Google or Outlook to import.
 * Each class carries the student's alert times, so the calendar alerts for it — the way a
 * browser, which can't fire a notification itself, still gets class alerts. Imported, not
 * subscribed: iOS strips the alerts from a subscribed calendar unless told not to.
 */
export const CalendarExport = {
  fileName: 'DCU Timetable.ics',
  /** The calendar's name, in the file and as the calendar the app makes in Google. */
  calendarName: 'DCU Timetable',

  /** Each class once, soonest first, with the student's alert times. */
  entries(events: TimetableEvent[], alerts: AlertSettings): CalendarEntry[] {
    const offsets = [...new Set([alerts.first, alerts.second].filter((o): o is number => o !== null))].sort((a, b) => a - b);
    const seen = new Set<string>();
    const entries: CalendarEntry[] = [];
    for (const event of [...events].sort((a, b) => a.start.getTime() - b.start.getTime())) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      const room = locationDisplay(event) === '—' ? null : locationDisplay(event);
      const delivery = event.type === 'onCampus' ? null : eventTypeLabel(event.type);
      entries.push({
        uid: `${event.id}@dcu-timetable`,
        start: event.start,
        end: event.end,
        title: shortTitleOf(event),
        place: [room, delivery].filter((p): p is string => p !== null).join(', '),
        notes: [titleOf(event), activitySummary(event.activity), staffText(event)].filter((p): p is string => !!p).join('\n'),
        alerts: offsets,
      });
    }
    return entries;
  },

  ics(events: TimetableEvent[], alerts: AlertSettings, now: Date): string {
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//DCU Timetable//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:${CalendarExport.calendarName}`,
    ];
    for (const entry of CalendarExport.entries(events, alerts)) {
      lines.push(
        'BEGIN:VEVENT',
        `UID:${text(entry.uid)}`,
        `DTSTAMP:${utc(now)}`,
        `DTSTART:${utc(entry.start)}`,
        `DTEND:${utc(entry.end)}`,
        `SUMMARY:${text(entry.title)}`,
      );
      if (entry.place) lines.push(`LOCATION:${text(entry.place)}`);
      if (entry.notes) lines.push(`DESCRIPTION:${text(entry.notes)}`);
      for (const offset of entry.alerts) {
        lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${text(entry.title)}`, `TRIGGER:${trigger(offset)}`, 'END:VALARM');
      }
      lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.map(fold).join('\r\n') + '\r\n';
  },
};

/** UTC, so the file needs no time-zone block and a calendar abroad still shows Dublin's hour. */
function utc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function trigger(minutes: number): string {
  return minutes === 0 ? 'PT0M' : `-PT${minutes}M`;
}

function text(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Lines longer than 75 bytes continue on the next after a space, never inside a character. */
function fold(line: string): string {
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const code = ch.codePointAt(0) ?? 0;
    const size = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    // The continuation's leading space counts against its 75.
    if (bytes + size > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}
