import { CalendarExport } from '../src/core/calendarExport';
import { ClassAlerts } from '../src/core/classAlerts';
import { GoogleCalendarRules } from '../src/core/googleCalendar';
import { GoogleAPIError, GoogleCalendar } from '../src/data/googleCalendar';
import { MemoryKV, PrefKey, Prefs } from '../src/data/storage';
import { at, event } from './helpers';

const lecture = {
  ...event('EEG1006[1]OC/L1/01', at(2026, 9, 28, 10), at(2026, 9, 28, 11), {
    id: 'lec', moduleName: 'EEG1006[1] Materials Engineering', locations: ['GLA.HG20'],
  }),
  staff: ['Doyle, Martin'],
};
const online = event('EEG1000[1]SY/L1/01', at(2026, 9, 28, 12), at(2026, 9, 28, 13), {
  id: 'onl', moduleName: 'EEG1000[1,2] Fundamentals of Professional Development', locations: [], type: 'synchronous',
});

describe('Add to Google Calendar: the events', () => {
  test('each class once, under the same UID as the .ics, with the same wording', () => {
    const entries = CalendarExport.entries([online, lecture, lecture], ClassAlerts.defaults);
    const [first, second] = entries.map(GoogleCalendarRules.event);
    expect(entries).toHaveLength(2);
    expect(first).toEqual({
      iCalUID: 'lec@dcu-timetable',
      summary: 'Materials Engineering',
      location: 'Nursing Building, Room 20, Ground floor',
      description: 'EEG1006[1] Materials Engineering\nLecture · Group 01\nDoyle, Martin',
      start: { dateTime: '2026-09-28T09:00:00.000Z' },
      end: { dateTime: '2026-09-28T10:00:00.000Z' },
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 15 }] },
    });
    expect(second.location).toBe('Online (live)');
    expect(CalendarExport.ics([lecture], ClassAlerts.defaults, at(2026, 9, 28, 8))).toContain(`UID:${first.iCalUID}`);
  });

  test("the student's alerts, and none for None rather than Google's default", () => {
    const reminders = (first: number | null, second: number | null) =>
      GoogleCalendarRules.event(CalendarExport.entries([lecture], { first, second })[0]).reminders;
    expect(reminders(60, 15).overrides.map((o) => o.minutes)).toEqual([15, 60]);
    expect(reminders(0, 0).overrides).toEqual([{ method: 'popup', minutes: 0 }]);
    expect(reminders(null, null)).toEqual({ useDefault: false, overrides: [] });
  });

  test('waits out rate limits and outages, and nothing else', () => {
    expect(GoogleCalendarRules.retryable(429, null)).toBe(true);
    expect(GoogleCalendarRules.retryable(503, null)).toBe(true);
    expect(GoogleCalendarRules.retryable(403, 'rateLimitExceeded')).toBe(true);
    expect(GoogleCalendarRules.retryable(403, 'userRateLimitExceeded')).toBe(true);
    expect(GoogleCalendarRules.retryable(403, 'forbidden')).toBe(false);
    expect(GoogleCalendarRules.retryable(400, null)).toBe(false);
    expect(GoogleCalendarRules.retryable(401, null)).toBe(false);
    expect([1, 2, 3, 4, 5].map(GoogleCalendarRules.backoffMs)).toEqual([1000, 2000, 4000, 8000, 8000]);
  });
});

/** A stand-in for the Calendar API: answers by method and path, and records each call. */
function fakeGoogle(answer: (method: string, path: string) => { status: number; body?: unknown }) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    const path = url.replace('https://www.googleapis.com/calendar/v3', '');
    const method = init.method ?? 'GET';
    calls.push({ method, path, body: init.body ? JSON.parse(init.body as string) : undefined });
    const { status, body } = answer(method, path);
    return new Response(JSON.stringify(body ?? {}), { status });
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

describe('Add to Google Calendar: the calendar', () => {
  const entries = CalendarExport.entries([lecture, online], ClassAlerts.defaults);

  test('makes a "DCU Live" calendar the first time, and remembers it', async () => {
    const prefs = new Prefs(new MemoryKV());
    const google = fakeGoogle((method, path) => (method === 'POST' && path === '/calendars' ? { status: 200, body: { id: 'cal1' } } : { status: 200 }));
    const progress: number[] = [];
    await new GoogleCalendar('client', prefs, google.fetchFn).add('token', entries, (n) => progress.push(n));

    expect(google.calls[0]).toMatchObject({ method: 'POST', path: '/calendars', body: { summary: 'DCU Live', timeZone: 'Europe/Dublin' } });
    expect(google.calls.slice(1).map((c) => c.path)).toEqual(['/calendars/cal1/events/import', '/calendars/cal1/events/import']);
    expect(progress).toEqual([1, 2]);
    expect(prefs.get(PrefKey.googleCalendar)).toBe('cal1');
  });

  test('fills the same calendar next time, and makes a new one if it has gone', async () => {
    const prefs = new Prefs(new MemoryKV());
    prefs.set(PrefKey.googleCalendar, 'cal1');
    const again = fakeGoogle(() => ({ status: 200 }));
    await new GoogleCalendar('client', prefs, again.fetchFn).add('token', entries, () => undefined);
    expect(again.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /calendars/cal1', 'POST /calendars/cal1/events/import', 'POST /calendars/cal1/events/import']);

    const gone = fakeGoogle((method, path) =>
      path === '/calendars/cal1' ? { status: 404 } : method === 'POST' && path === '/calendars' ? { status: 200, body: { id: 'cal2' } } : { status: 200 });
    await new GoogleCalendar('client', prefs, gone.fetchFn).add('token', entries, () => undefined);
    expect(gone.calls.filter((c) => c.path.endsWith('/import')).every((c) => c.path === '/calendars/cal2/events/import')).toBe(true);
    expect(prefs.get(PrefKey.googleCalendar)).toBe('cal2');
  });

  test('tries a class again after a rate limit, and stops at a refusal', async () => {
    jest.useFakeTimers();
    try {
      const prefs = new Prefs(new MemoryKV());
      prefs.set(PrefKey.googleCalendar, 'cal1');
      let limited = 1;
      const google = fakeGoogle((_, path) => {
        if (path.endsWith('/import') && limited-- > 0) return { status: 403, body: { error: { errors: [{ reason: 'rateLimitExceeded' }] } } };
        return { status: 200 };
      });
      const adding = new GoogleCalendar('client', prefs, google.fetchFn).add('token', [entries[0]], () => undefined);
      await jest.advanceTimersByTimeAsync(1_000);
      await adding;
      expect(google.calls.filter((c) => c.path.endsWith('/import'))).toHaveLength(2);

      const refusing = fakeGoogle((_, path) => (path.endsWith('/import') ? { status: 400 } : { status: 200 }));
      await expect(new GoogleCalendar('client', prefs, refusing.fetchFn).add('token', entries, () => undefined)).rejects.toBeInstanceOf(GoogleAPIError);
      // Both workers stop: one class tried each, none retried.
      expect(refusing.calls.filter((c) => c.path.endsWith('/import')).length).toBeLessThanOrEqual(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
