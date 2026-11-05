import { CalendarEntry } from './calendarExport';

/**
 * Add to Google Calendar, the pure half: what each class looks like to Google's Calendar API
 * and which failures are worth waiting out. Google has no way to open an .ics on a phone —
 * its Android app won't import one — so the web build signs in with Google and adds the
 * classes itself, to a "DCU Timetable" calendar of their own.
 */

/** An event as `events.import` takes it. */
export interface GoogleEventBody {
  iCalUID: string;
  summary: string;
  location?: string;
  description?: string;
  start: { dateTime: string };
  end: { dateTime: string };
  reminders: { useDefault: false; overrides: { method: 'popup'; minutes: number }[] };
}

export const GoogleCalendarRules = {
  /**
   * The narrowest scope that works: make calendars and manage events on those only. The app
   * never sees, or could touch, anything else in the student's Google Calendar.
   */
  scope: 'https://www.googleapis.com/auth/calendar.app.created',
  timeZone: 'Europe/Dublin',
  /** Requests in flight at once: quick enough for a year of classes, and well under Google's limits. */
  concurrency: 4,
  /** Tries per request before giving up, waiting longer each time. */
  maxAttempts: 5,

  /**
   * One class. Imported under the file's UID, so adding the year again updates each class
   * rather than doubling it. The alerts are the student's own; none set is none in Google too,
   * not the calendar's default.
   */
  event(entry: CalendarEntry): GoogleEventBody {
    const body: GoogleEventBody = {
      iCalUID: entry.uid,
      summary: entry.title,
      start: { dateTime: entry.start.toISOString() },
      end: { dateTime: entry.end.toISOString() },
      reminders: { useDefault: false, overrides: entry.alerts.map((minutes) => ({ method: 'popup' as const, minutes })) },
    };
    if (entry.place) body.location = entry.place;
    if (entry.notes) body.description = entry.notes;
    return body;
  },

  /** Google's rate limits and its own hiccups pass; anything else won't on a second try. */
  retryable(status: number, reason: string | null): boolean {
    if (status === 429 || status >= 500) return true;
    return status === 403 && (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded');
  },

  /** How long to wait before try `attempt` (1 is the first retry): 1s, 2s, 4s, 8s. */
  backoffMs(attempt: number): number {
    return Math.min(8_000, 1_000 * 2 ** (attempt - 1));
  },
};
