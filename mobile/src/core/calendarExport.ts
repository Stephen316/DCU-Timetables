import { activitySummary } from './activityCode';
import { AlertSettings } from './classAlerts';
import { locationDisplay } from './roomLocation';
import { eventTypeLabel, shortTitleOf, staffText, TimetableEvent, titleOf } from './timetableEvent';

/**
 * The timetable as an iCalendar file (RFC 5545), for Calendar, Google or Outlook to import.
 * Each class carries the student's alert times, so the calendar alerts for it — the way a
 * browser, which can't fire a notification itself, still gets class alerts. Imported, not
 * subscribed: iOS strips the alerts from a subscribed calendar unless told not to.
 */
export const CalendarExport = {
  fileName: 'DCU Timetable.ics',

  ics(events: TimetableEvent[], alerts: AlertSettings, now: Date): string {
    const offsets = [...new Set([alerts.first, alerts.second].filter((o): o is number => o !== null))].sort((a, b) => a - b);
    const seen = new Set<string>();
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//DCU Timetable//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:DCU Timetable',
    ];
    for (const event of [...events].sort((a, b) => a.start.getTime() - b.start.getTime())) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      const title = shortTitleOf(event);
      const room = locationDisplay(event) === '—' ? null : locationDisplay(event);
      const delivery = event.type === 'onCampus' ? null : eventTypeLabel(event.type);
      const place = [room, delivery].filter((p): p is string => p !== null).join(', ');
      const notes = [titleOf(event), activitySummary(event.activity), staffText(event)].filter((p): p is string => !!p);
      lines.push(
        'BEGIN:VEVENT',
        // Stable across exports, so importing again updates a class rather than doubling it.
        `UID:${text(event.id)}@dcu-timetable`,
        `DTSTAMP:${utc(now)}`,
        `DTSTART:${utc(event.start)}`,
        `DTEND:${utc(event.end)}`,
        `SUMMARY:${text(title)}`,
      );
      if (place) lines.push(`LOCATION:${text(place)}`);
      if (notes.length > 0) lines.push(`DESCRIPTION:${text(notes.join('\n'))}`);
      for (const offset of offsets) {
        lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${text(title)}`, `TRIGGER:${trigger(offset)}`, 'END:VALARM');
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
