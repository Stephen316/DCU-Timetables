import { CancellationRules, makeReport } from '../src/core/cancellation';
import { makeChange , TimetableAudience } from '../src/core/profile';
import { groupKeyOf, TeachingWeek, TimetableCategory, TimetableEvent, WeekCalendar } from '../src/core/timetableEvent';
import { TimetableSource } from '../src/data/dcuApi';
import { createServices } from '../src/data/services';
import { MemoryKV, PrefKey } from '../src/data/storage';
import { WeekModel } from '../src/features/week/WeekModel';
import { at, event } from './helpers';

/** Weeks 1–3 of September 2026: Mondays the 14th, 21st and 28th. */
const weeks: TeachingWeek[] = [
  { number: 1, label: '1', firstDay: at(2026, 9, 14) },
  { number: 2, label: '2', firstDay: at(2026, 9, 21) },
  { number: 3, label: '3', firstDay: at(2026, 9, 28) },
];

class FakeSource implements TimetableSource {
  calls: number[] = [];
  constructor(private readonly all: TimetableEvent[]) {}
  async searchProgrammes() { return []; }
  async weekCalendar() { return new WeekCalendar(weeks, []); }
  async events(_c: TimetableCategory, requested: TeachingWeek[]) {
    this.calls.push(...requested.map((w) => w.number));
    return this.all.filter((e) => requested.some((w) => e.start >= w.firstDay && e.start.getTime() < w.firstDay.getTime() + 7 * 864e5));
  }
}

const programme: TimetableCategory = { identity: 'p', name: 'ECE1 (Electronic Eng)', categoryTypeIdentity: 't' };

async function setup(events: TimetableEvent[], hidden: string[] = [], audience: TimetableAudience | null = null) {
  const services = await createServices({ kv: new MemoryKV(), secrets: { get: async () => null, set: async () => {}, remove: async () => {} }, env: {} });
  const source = new FakeSource(events);
  return { services, source, model: (s = services) => new WeekModel(s, programme, source, audience, new Set(hidden)) };
}

async function settle() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

afterEach(() => jest.useRealTimers());

describe('Week model', () => {
  const lectureWed = event('EEG1001[1]OC/L1/01', at(2026, 9, 23, 9), at(2026, 9, 23, 11), { id: 'lec' });
  const labA = event('EEG1001[1]OC/P1/01', at(2026, 9, 23, 10), at(2026, 9, 23, 12), { id: 'labA' });
  const labB = event('EEG1001[1]OC/P2/01', at(2026, 9, 24, 14), at(2026, 9, 24, 17), { id: 'labB' });
  const nextWeek = event('EEG1004[1]OC/L1/01', at(2026, 9, 28, 9), at(2026, 9, 28, 10), { id: 'next' });

  test('opens on the current week, loads it and its neighbours, and finds clashes', async () => {
    jest.useFakeTimers({ now: at(2026, 9, 23, 8), doNotFake: ['setTimeout', 'setImmediate', 'nextTick', 'queueMicrotask'] });
    const { source, model } = await setup([lectureWed, labA, labB, nextWeek]);
    const m = model();
    await m.start();
    await settle();
    expect(m.weekLabel).toBe('Week 2');
    expect(m.events.map((e) => e.id)).toEqual(['lec', 'labA', 'labB']);
    expect(m.clashingIDs).toEqual(new Set(['lec', 'labA']));
    expect(source.calls.sort()).toEqual([1, 2, 3]);
    // Wednesday, during the day.
    expect(m.dayIndex).toBe(2);
    expect(m.eventWithID('next')?.id).toBe('next');
    expect(m.loadedModuleKeys).toEqual(['EEG1001', 'EEG1004']);
  });

  test('Friday evening opens on Monday of the next week', async () => {
    jest.useFakeTimers({ now: at(2026, 9, 25, 19), doNotFake: ['setTimeout', 'setImmediate', 'nextTick', 'queueMicrotask'] });
    const { model } = await setup([lectureWed, nextWeek]);
    const m = model();
    await m.start();
    await settle();
    expect(m.weekLabel).toBe('Week 3');
    expect(m.dayIndex).toBe(0);
  });

  test('the week pager stops at both ends of the year', async () => {
    jest.useFakeTimers({ now: at(2026, 9, 15, 9), doNotFake: ['setTimeout', 'setImmediate', 'nextTick', 'queueMicrotask'] });
    const { model } = await setup([]);
    const m = model();
    await m.start();
    await settle();
    expect(m.canStep(-1)).toBe(false);
    m.stepIndex(-1);
    expect(m.weekIndex).toBe(0);
    m.stepIndex(5);
    await settle();
    expect(m.weekIndex).toBe(2);
    expect(m.canStep(1)).toBe(false);
  });

  test('hidden groups leave the timetable and the clash check, but not the module list', async () => {
    jest.useFakeTimers({ now: at(2026, 9, 23, 8), doNotFake: ['setTimeout', 'setImmediate', 'nextTick', 'queueMicrotask'] });
    const { model } = await setup([lectureWed, labA, labB]);
    const m = model();
    await m.start();
    await settle();
    m.updateHiddenGroups(new Set([groupKeyOf(labA)]));
    expect(m.events.map((e) => e.id)).toEqual(['lec', 'labB']);
    expect(m.clashingIDs.size).toBe(0);
    expect(m.loadedModuleKeys).toEqual(['EEG1001']);
  });

  test("the audience's saved changes are applied to the week", async () => {
    jest.useFakeTimers({ now: at(2026, 9, 23, 8), doNotFake: ['setTimeout', 'setImmediate', 'nextTick', 'queueMicrotask'] });
    const { services, model } = await setup([lectureWed, labB], [], new TimetableAudience('EEG1', 'B'));
    services.changeCache.store([
      makeChange({ id: 'r', courseKey: 'EEG1', group: 'B', kind: 'remove', module: 'EEG1001', dates: ['2026-09-24'], start: '14:00' }),
      makeChange({ id: 'a', courseKey: 'EEG1', group: 'B', kind: 'add', module: 'EEG1004', title: 'Make-up lab', dates: ['2026-09-25'], start: '10:00', end: '12:00', room: 'S205' }),
    ], 'EEG1');
    const m = model();
    await m.start();
    await settle();
    expect(m.events.map((e) => e.id)).toEqual(['lec', 'change-a-2026-09-25']);
  });

  test('three reports flag a class; the outline follows', async () => {
    jest.useFakeTimers({ now: at(2026, 9, 23, 8), doNotFake: ['setTimeout', 'setImmediate', 'nextTick', 'queueMicrotask'] });
    const { services, model } = await setup([lectureWed]);
    const key = CancellationRules.eventKey(lectureWed);
    for (const who of ['a', 'b', 'c']) await services.cancellations.submit(makeReport(key, who));
    const m = model();
    await m.start();
    await settle();
    expect(m.highlight(lectureWed)).toEqual({ kind: 'cancelled', reportCount: 3, decidedBy: null });
    expect(services.prefs.get(PrefKey.hiddenGroups)).toBeNull();
  });
});
