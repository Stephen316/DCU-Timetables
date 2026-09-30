import { CancellationRules } from '../src/core/cancellation';
import { makeProfile } from '../src/core/profile';
import { TimetableEdits } from '../src/core/timetableEdits';
import { TeachingWeek, TimetableCategory, WeekCalendar } from '../src/core/timetableEvent';
import { MemoryAlertScheduler } from '../src/data/alerts';
import { LabRotationCache } from '../src/data/courseData';
import { TimetableSource } from '../src/data/dcuApi';
import { createServices } from '../src/data/services';
import { MemoryKV, PrefKey, Prefs } from '../src/data/storage';
import { bundledRotation, ProfileTimetableSource } from '../src/data/timetable';
import { TimetableEditStore } from '../src/data/timetableEdits';
import { WeekModel } from '../src/features/week/WeekModel';
import { at, event } from './helpers';

// Two Mondays a week apart, and the same lab at 14:00 on each.
const lab = (day: number, id: string) =>
  event('EEG1001[1]OC/P1/03', at(2026, 9, day, 14), at(2026, 9, day, 17), { id, moduleName: 'EEG1001[1] Workshop' });
const labThisWeek = lab(28, 'lab-1');
const labNextWeek = event('EEG1001[1]OC/P1/03', at(2026, 10, 5, 14), at(2026, 10, 5, 17), { id: 'lab-2', moduleName: 'EEG1001[1] Workshop' });
const lecture = event('EEG1006[1]OC/L1/01', at(2026, 9, 28, 10), at(2026, 9, 28, 11), { id: 'lec', moduleName: 'EEG1006[1] Materials' });

const ids = (list: { id: string }[]) => list.map((e) => e.id);

describe('Timetable edits', () => {
  test('removing every week takes the class off each week; once, only that day', () => {
    const weekly = [TimetableEdits.make('remove', 'weekly', labThisWeek)];
    expect(ids(TimetableEdits.apply([lecture, labThisWeek], [], weekly).events)).toEqual(['lec']);
    expect(ids(TimetableEdits.apply([labNextWeek], [], weekly).events)).toEqual([]);

    const once = [TimetableEdits.make('remove', 'once', labThisWeek)];
    expect(ids(TimetableEdits.apply([lecture, labThisWeek], [], once).events)).toEqual(['lec']);
    expect(ids(TimetableEdits.apply([labNextWeek], [], once).events)).toEqual(['lab-2']);
  });

  test('a removed class becomes a ghost, so it can be put back', () => {
    const week = TimetableEdits.apply([labThisWeek], [], [TimetableEdits.make('remove', 'once', labThisWeek)]);
    expect(ids(week.ghosts)).toEqual(['lab-1']);
  });

  test("adding a ghost every week puts it in each week it runs; once, only that day", () => {
    const weekly = [TimetableEdits.make('add', 'weekly', labThisWeek)];
    expect(ids(TimetableEdits.apply([lecture], [labThisWeek], weekly).events)).toEqual(['lec', 'lab-1']);
    expect(ids(TimetableEdits.apply([], [labNextWeek], weekly).events)).toEqual(['lab-2']);

    const once = [TimetableEdits.make('add', 'once', labThisWeek)];
    const next = TimetableEdits.apply([], [labNextWeek], once);
    expect(ids(next.events)).toEqual([]);
    expect(ids(next.ghosts)).toEqual(['lab-2']);
  });

  test('a once-off beats every week, for its day only', () => {
    const edits = [TimetableEdits.make('remove', 'weekly', labThisWeek), TimetableEdits.make('add', 'once', labThisWeek)];
    expect(ids(TimetableEdits.apply([labThisWeek], [], edits).events)).toEqual(['lab-1']);
    expect(ids(TimetableEdits.apply([labNextWeek], [], edits).events)).toEqual([]);
  });

  test('a new edit replaces what it overrides, so the list never answers the same question twice', () => {
    const removeOnce = TimetableEdits.make('remove', 'once', labThisWeek);
    const addOnce = TimetableEdits.make('add', 'once', labThisWeek);
    const addNextWeek = TimetableEdits.make('add', 'once', labNextWeek);
    const removeWeekly = TimetableEdits.make('remove', 'weekly', labThisWeek);

    expect(TimetableEdits.adding([removeOnce], addOnce)).toEqual([addOnce]);
    expect(TimetableEdits.adding([removeOnce], addNextWeek)).toEqual([removeOnce, addNextWeek]);
    // Every week settles the class on every day, once-offs included.
    expect(TimetableEdits.adding([removeOnce, addNextWeek], removeWeekly)).toEqual([removeWeekly]);
    // Another class at the same time is left alone.
    const other = TimetableEdits.make('remove', 'weekly', lecture);
    expect(TimetableEdits.adding([other], removeWeekly)).toEqual([other, removeWeekly]);
  });

  test("the name tells apart a rotation's Workshop and Drawing, which share a code and a time", () => {
    const workshop = event('EEG1001', at(2026, 9, 28, 14), at(2026, 9, 28, 17), { id: 'w', moduleName: 'Workshop · Engineering Practice' });
    const drawing = event('EEG1001', at(2026, 9, 28, 14), at(2026, 9, 28, 17), { id: 'd', moduleName: 'Drawing · Engineering Practice' });
    const edits = [TimetableEdits.make('add', 'weekly', drawing)];
    expect(ids(TimetableEdits.apply([], [workshop, drawing], edits).events)).toEqual(['d']);
  });

  test('saved edits are read defensively', () => {
    const good = TimetableEdits.make('remove', 'once', labThisWeek);
    expect(TimetableEdits.decode([good, { kind: 'hide' }, null, { ...good, repeat: 'weekly' }, 'x'])).toEqual([good]);
    expect(TimetableEdits.decode({})).toEqual([]);
    const weekly = TimetableEdits.make('add', 'weekly', labThisWeek);
    expect(TimetableEdits.decode(JSON.parse(JSON.stringify([weekly])))).toEqual([weekly]);
  });
});

describe('Carrying over "I won\'t attend"', () => {
  test('a class marked before the update stays off, and the old list is cleared', () => {
    const prefs = new Prefs(new MemoryKV());
    prefs.setJSON(PrefKey.skipped, [CancellationRules.eventKey(labThisWeek), 'not a key']);
    const edits = TimetableEditStore.edits(prefs);
    expect(edits).toHaveLength(1);
    expect(ids(TimetableEdits.apply([labThisWeek, lecture], [], edits).events)).toEqual(['lec']);
    // Only that day: it was one class marked, not the module.
    expect(ids(TimetableEdits.apply([labNextWeek], [], edits).events)).toEqual(['lab-2']);
    expect(prefs.getJSON(PrefKey.skipped, null)).toBeNull();
    expect(TimetableEditStore.edits(prefs)).toEqual(edits);
  });
});

describe('Edit timetable in the week model', () => {
  const weeks: TeachingWeek[] = [
    { number: 1, label: '1', firstDay: at(2026, 9, 28) },
    { number: 2, label: '2', firstDay: at(2026, 10, 5) },
  ];
  const programme: TimetableCategory = { identity: 'p', name: 'ECE1', categoryTypeIdentity: 't' };
  const inWeek = <T extends { start: Date }>(list: T[], requested: TeachingWeek[]) =>
    list.filter((e) => requested.some((w) => e.start >= w.firstDay && e.start.getTime() < w.firstDay.getTime() + 7 * 864e5));
  const source: TimetableSource = {
    async searchProgrammes() { return []; },
    async weekCalendar() { return new WeekCalendar(weeks, []); },
    async events(_c, requested) { return inWeek([lecture], requested); },
    async otherEvents(_c, requested) { return inWeek([labThisWeek, labNextWeek], requested); },
  };
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

  afterEach(() => jest.useRealTimers());

  test("another group's lab is a ghost until added, then it's the student's — timetable, alerts and all", async () => {
    jest.useFakeTimers({ now: at(2026, 9, 28, 8), doNotFake: ['setTimeout', 'setImmediate', 'nextTick', 'queueMicrotask'] });
    const alerts = new MemoryAlertScheduler();
    const services = await createServices({ kv: new MemoryKV(), secrets: { get: async () => null, set: async () => {}, remove: async () => {} }, env: {}, alerts });
    const model = new WeekModel(services, programme, source, null);
    await model.start();
    await settle();
    expect(ids(model.eventsByWeekNumber.get(1) ?? [])).toEqual(['lec']);
    expect(ids(model.ghostsByWeekNumber.get(1) ?? [])).toEqual(['lab-1']);

    model.edit('add', 'weekly', labThisWeek);
    expect(ids(model.eventsByWeekNumber.get(1) ?? [])).toEqual(['lec', 'lab-1']);
    expect(ids(model.eventsByWeekNumber.get(2) ?? [])).toEqual(['lab-2']);
    expect(model.ghostsByWeekNumber.get(1)).toEqual([]);
    expect(alerts.scheduled.map((a) => a.eventID)).toContain('lab-1');

    model.edit('remove', 'once', labNextWeek);
    expect(model.eventsByWeekNumber.get(2)).toEqual([]);
    expect(ids(model.ghostsByWeekNumber.get(2) ?? [])).toEqual(['lab-2']);
    model.dispose();
  });
});

describe("Other groups' rotation sessions", () => {
  test("are every session the student's group isn't in, without the student's rooms", async () => {
    const rotation = bundledRotation();
    if (!rotation) throw new Error('No bundled rotation');
    const profile = makeProfile({ name: 'A Student', group: 'A', workshop: 'SG23', drawing: 'SB39' });
    const source = new ProfileTimetableSource(profile, new LabRotationCache(new Prefs(new MemoryKV())));
    const week = rotation.sessions.find((s) => !s.groups.includes('A'))?.week;
    if (week === undefined) throw new Error('Group A is in every session');
    const others = await source.otherEvents(
      { identity: 'x', name: 'x', categoryTypeIdentity: '' },
      [{ number: week, label: String(week), firstDay: new Date() }],
    );
    const expected = rotation.sessions.filter((s) => s.week === week && !s.groups.includes('A'));
    expect(others).toHaveLength(expected.length);
    expect(others.every((e) => e.locations.length === 0)).toBe(true);
  });
});
