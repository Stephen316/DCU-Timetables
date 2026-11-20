import { CustomClass, CustomClasses, timeAfter } from '../src/core/customClasses';
import { DublinTime } from '../src/core/time';
import { TimetableEdits } from '../src/core/timetableEdits';

// Monday 16 November 2026, and the Monday after.
const thisWeek = DublinTime.date('2026-11-16', '00:00')!;
const nextWeek = DublinTime.date('2026-11-23', '00:00')!;
const weekBefore = DublinTime.date('2026-11-09', '00:00')!;

const stats: CustomClass = {
  id: 'abc', code: 'MS134', title: 'Statistics', kind: 'L', date: '2026-11-18',
  start: '14:30', end: '15:30', repeat: 'once', room: 'GLA.QG21',
};

describe('Classes at a time of your own', () => {
  test('a once-off is drawn on its day only, at the time set', () => {
    const [event] = CustomClasses.eventsIn([stats], thisWeek);
    expect(DublinTime.dateString(event.start)).toBe('2026-11-18');
    expect(DublinTime.timeString(event.start)).toBe('14:30');
    expect(DublinTime.timeString(event.end)).toBe('15:30');
    expect(event.locations).toEqual(['GLA.QG21']);
    expect(event.activity.moduleCode).toBe('MS134');
    expect(event.activity.kind).toBe('L');
    expect(CustomClasses.eventsIn([stats], nextWeek)).toEqual([]);
  });

  test('an every-week one is on that weekday from its first week on, not before', () => {
    const weekly = { ...stats, repeat: 'weekly' as const };
    expect(CustomClasses.eventsIn([weekly], nextWeek).map((e) => DublinTime.dateString(e.start))).toEqual(['2026-11-25']);
    expect(CustomClasses.eventsIn([weekly], weekBefore)).toEqual([]);
  });

  test('its events say which saved class they came from', () => {
    const [event] = CustomClasses.eventsIn([stats], thisWeek);
    expect(CustomClasses.isCustom(event)).toBe(true);
    expect(CustomClasses.idOf(event)).toBe('abc');
  });

  test('one day can be taken off an every-week one like any class', () => {
    const weekly = { ...stats, repeat: 'weekly' as const };
    const [event] = CustomClasses.eventsIn([weekly], thisWeek);
    const edits = [TimetableEdits.make('remove', 'once', event)];
    expect(TimetableEdits.apply([event], [], edits).events).toEqual([]);
    expect(TimetableEdits.apply(CustomClasses.eventsIn([weekly], nextWeek), [], edits).events).toHaveLength(1);
  });

  test('reading the saved list drops anything malformed', () => {
    expect(CustomClasses.decode([stats, { ...stats, end: '14:00' }, { ...stats, kind: 'X' }, null, 'nope'])).toEqual([stats]);
    expect(CustomClasses.decode('nope')).toEqual([]);
  });

  test('an end time is the start plus the length, never past midnight', () => {
    expect(timeAfter('09:00', 60)).toBe('10:00');
    expect(timeAfter('14:30', 120)).toBe('16:30');
    expect(timeAfter('23:30', 60)).toBeNull();
  });
});
