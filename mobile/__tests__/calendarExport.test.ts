import { CalendarExport } from '../src/core/calendarExport';
import { ClassAlerts } from '../src/core/classAlerts';
import { at, event } from './helpers';

describe('Export to Calendar', () => {
  const now = at(2026, 9, 28, 8);
  const lecture = {
    ...event('EEG1006[1]OC/L1/01', at(2026, 9, 28, 10), at(2026, 9, 28, 11), {
      id: 'lec', moduleName: 'EEG1006[1] Materials Engineering', locations: ['GLA.HG20'],
    }),
    staff: ['Doyle, Martin'],
  };
  const online = event('EEG1000[1]SY/L1/01', at(2026, 9, 28, 12), at(2026, 9, 28, 13), {
    id: 'onl', moduleName: 'EEG1000[1,2] Fundamentals of Professional Development', locations: [], type: 'synchronous',
  });
  const unfolded = (ics: string) => ics.replace(/\r\n /g, '');
  const vevents = (ics: string) => unfolded(ics).split('BEGIN:VEVENT').slice(1);

  test('one event per class, soonest first, in UTC, titled as the day view titles it', () => {
    const ics = CalendarExport.ics([online, lecture, lecture], ClassAlerts.defaults, now);
    const [first, second] = vevents(ics);
    expect(vevents(ics)).toHaveLength(2);
    expect(first).toContain('UID:lec@dcu-timetable');
    // 10:00 in Dublin's summer time.
    expect(first).toContain('DTSTART:20260928T090000Z');
    expect(first).toContain('DTEND:20260928T100000Z');
    expect(first).toContain('SUMMARY:Materials Engineering');
    expect(first).toContain('DESCRIPTION:EEG1006[1] Materials Engineering\\nLecture · Group 01\\nDoyle\\, Martin');
    expect(second).toContain('LOCATION:Online (live)');
  });

  test("carries the student's alert times, the same time twice once, and none for None", () => {
    const triggers = (ics: string) => vevents(ics)[0].match(/TRIGGER:\S+/g) ?? [];
    expect(triggers(CalendarExport.ics([lecture], { first: 15, second: 60 }, now))).toEqual(['TRIGGER:-PT15M', 'TRIGGER:-PT60M']);
    expect(triggers(CalendarExport.ics([lecture], { first: 0, second: 0 }, now))).toEqual(['TRIGGER:PT0M']);
    expect(CalendarExport.ics([lecture], { first: null, second: null }, now)).not.toContain('VALARM');
  });

  test('lines end CRLF and fold at 75 bytes without splitting a character', () => {
    const long = event('EEG1006[1]OC/L1/01', at(2026, 9, 28, 10), at(2026, 9, 28, 11), {
      id: 'long', moduleName: `EEG1006[1] ${'Éire–'.repeat(30)}`,
    });
    const ics = CalendarExport.ics([long], ClassAlerts.defaults, now);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toContain('\n');
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    expect(unfolded(ics)).toContain(`SUMMARY:${'Éire–'.repeat(30)}`);
  });

  test('an empty timetable is still a calendar', () => {
    expect(CalendarExport.ics([], ClassAlerts.defaults, now)).toMatch(/^BEGIN:VCALENDAR\r\n[\s\S]*END:VCALENDAR\r\n$/);
  });
});
