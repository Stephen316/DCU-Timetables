import { ClassAlerts } from '../src/core/classAlerts';
import { CancellationRules } from '../src/core/cancellation';
import { TeachingWeek, TimetableCategory, TimetableEvent, WeekCalendar } from '../src/core/timetableEvent';
import { MemoryAlertScheduler } from '../src/data/alerts';
import { TimetableSource } from '../src/data/dcuApi';
import { createServices } from '../src/data/services';
import { MemoryKV, PrefKey } from '../src/data/storage';
import { WeekModel } from '../src/features/week/WeekModel';
import { at, event } from './helpers';

const noneOff = () => false;

describe('Class alerts', () => {
  const now = at(2026, 9, 28, 8);
  const lecture = event('EEG1006[1]OC/L1/01', at(2026, 9, 28, 10), at(2026, 9, 28, 11), {
    id: 'lec', moduleName: 'EEG1006[1] Materials Engineering', locations: ['GLA.HG20'],
  });
  const online = event('EEG1000[1]SY/L1/01', at(2026, 9, 28, 12), at(2026, 9, 28, 13), {
    id: 'onl', moduleName: 'EEG1000[1,2] Fundamentals of Professional Development', locations: [], type: 'synchronous',
  });

  test('alerts 15 minutes before each class by default, soonest first, titled by module name', () => {
    const plan = ClassAlerts.plan([online, lecture], ClassAlerts.defaults, now, noneOff);
    expect(plan.map((a) => [a.eventID, a.fireAt])).toEqual([['lec', at(2026, 9, 28, 9, 45)], ['onl', at(2026, 9, 28, 11, 45)]]);
    expect(plan[0].title).toBe('Materials Engineering');
    expect(plan[0].body).toMatch(/^In 15 minutes · 10:00–11:00 · /);
    expect(plan[1].body).toBe('In 15 minutes · 12:00–13:00 · Online (live)');
  });

  test('a second alert adds another; the same time twice alerts once; none alerts nothing', () => {
    expect(ClassAlerts.plan([lecture], { first: 15, second: 60 }, now, noneOff).map((a) => a.id)).toEqual(['lec@60', 'lec@15']);
    expect(ClassAlerts.plan([lecture], { first: 15, second: 15 }, now, noneOff)).toHaveLength(1);
    expect(ClassAlerts.plan([lecture], { first: null, second: null }, now, noneOff)).toEqual([]);
    expect(ClassAlerts.plan([lecture], { first: 0, second: null }, now, noneOff)[0].body).toMatch(/^Starting now · /);
  });

  test("an alert whose time has passed isn't scheduled, even if the class is still to come", () => {
    const plan = ClassAlerts.plan([lecture], { first: 15, second: 120 }, at(2026, 9, 28, 9), noneOff);
    expect(plan.map((a) => a.id)).toEqual(['lec@15']);
  });

  test("a class the student won't be at doesn't alert", () => {
    expect(ClassAlerts.plan([lecture, online], ClassAlerts.defaults, now, (e) => e.id === 'lec').map((a) => a.eventID)).toEqual(['onl']);
  });

  test("stops short of iOS's 64 pending notifications, keeping the soonest", () => {
    const many: TimetableEvent[] = Array.from({ length: 40 }, (_, i) =>
      event('EEG1006[1]OC/L1/01', at(2026, 9, 29 + Math.floor(i / 8), 9 + (i % 8)), undefined, { id: `c${i}` }));
    const plan = ClassAlerts.plan(many, { first: 15, second: 60 }, now, noneOff);
    expect(plan).toHaveLength(ClassAlerts.limit);
    expect(plan[0].eventID).toBe('c0');
  });

  test('saved settings are read defensively', () => {
    expect(ClassAlerts.settings(null)).toEqual(ClassAlerts.defaults);
    expect(ClassAlerts.settings({ first: 30, second: null })).toEqual({ first: 30, second: null });
    expect(ClassAlerts.settings({ first: 7, second: 'soon' })).toEqual(ClassAlerts.defaults);
  });

  test('labels read as Calendar does', () => {
    expect(ClassAlerts.options.map(ClassAlerts.label)).toEqual([
      'None', 'At start of class', '5 minutes before', '10 minutes before', '15 minutes before', '30 minutes before',
      '1 hour before', '2 hours before',
    ]);
  });
});

describe('Class alerts from the week model', () => {
  const weeks: TeachingWeek[] = [
    { number: 1, label: '1', firstDay: at(2026, 9, 21) },
    { number: 2, label: '2', firstDay: at(2026, 9, 28) },
    { number: 3, label: '3', firstDay: at(2026, 10, 5) },
  ];
  const programme: TimetableCategory = { identity: 'p', name: 'ECE1', categoryTypeIdentity: 't' };
  const monday = event('EEG1006[1]OC/L1/01', at(2026, 9, 28, 10), at(2026, 9, 28, 11), { id: 'mon', moduleName: 'EEG1006[1] Materials Engineering' });
  const tuesday = event('EEG1006[1]OC/L1/01', at(2026, 9, 29, 10), at(2026, 9, 29, 11), { id: 'tue', moduleName: 'EEG1006[1] Materials Engineering' });
  const source: TimetableSource = {
    async searchProgrammes() { return []; },
    async weekCalendar() { return new WeekCalendar(weeks, []); },
    async events(_c, requested) {
      return [monday, tuesday].filter((e) => requested.some((w) => e.start >= w.firstDay && e.start.getTime() < w.firstDay.getTime() + 7 * 864e5));
    },
  };
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

  afterEach(() => jest.useRealTimers());

  test('schedules the loaded classes, follows the settings and "not attending", and sign-out clears them', async () => {
    jest.useFakeTimers({ now: at(2026, 9, 28, 8), doNotFake: ['setTimeout', 'setImmediate', 'nextTick', 'queueMicrotask'] });
    const alerts = new MemoryAlertScheduler();
    const services = await createServices({ kv: new MemoryKV(), secrets: { get: async () => null, set: async () => {}, remove: async () => {} }, env: {}, alerts });
    const model = new WeekModel(services, programme, source, null);
    await model.start();
    await settle();
    expect(alerts.scheduled.map((a) => a.id)).toEqual(['mon@15', 'tue@15']);

    services.prefs.setJSON(PrefKey.classAlerts, { first: 5, second: null });
    expect(alerts.scheduled.map((a) => a.id)).toEqual(['mon@5', 'tue@5']);

    services.prefs.setJSON(PrefKey.skipped, [CancellationRules.eventKey(monday)]);
    expect(alerts.scheduled.map((a) => a.id)).toEqual(['tue@5']);

    // Nothing changed, so nothing is rescheduled.
    const before = alerts.replaceCount;
    model.scheduleAlerts();
    expect(alerts.replaceCount).toBe(before);

    services.signOut();
    await settle();
    expect(alerts.scheduled).toEqual([]);

    // Left behind by the sign-out, it schedules nothing for whoever signs in next.
    model.dispose();
    services.prefs.setJSON(PrefKey.classAlerts, { first: 30, second: null });
    await settle();
    expect(alerts.scheduled).toEqual([]);
  });
});
