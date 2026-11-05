import { makeDeadline } from '../src/core/deadline';
import { TeachingWeek, TimetableCategory, TimetableEvent, WeekCalendar } from '../src/core/timetableEvent';
import { DCUAPIClient, MODULE_IDENTITY_MAX_AGE_MS, TimetableSource } from '../src/data/dcuApi';
import { withTimeLimit } from '../src/data/rest';
import { createServices } from '../src/data/services';
import { MemoryKV, PrefKey, Prefs } from '../src/data/storage';
import { TimetableCache } from '../src/data/timetable';
import { DeadlinesModel } from '../src/features/deadlines/DeadlinesModel';
import { WeekModel } from '../src/features/week/WeekModel';
import { at, event } from './helpers';

/**
 * How quickly the timetable and deadlines arrive: what has to be waited for before each can
 * show, and what never has to be asked twice.
 */

const viewOptions = {
  Weeks: [
    { WeekNumber: 2, WeekLabel: '2', FirstDayInWeek: '2026-09-14T00:00:00+00:00' },
    { WeekNumber: 3, WeekLabel: '3', FirstDayInWeek: '2026-09-21T00:00:00+00:00' },
  ],
  Days: [{ Name: 'Monday', DayOfWeek: 1, IsDefault: true }],
};
const week3: TeachingWeek = { number: 3, label: '3', firstDay: new Date('2026-09-21T00:00:00Z') };

/** DCU's API, answering by path, with how many requests were open at once at the busiest. */
function fakeDCU() {
  const paths: string[] = [];
  let open = 0;
  let mostAtOnce = 0;
  const fetchFn = (async (url: string) => {
    const path = new URL(url).pathname;
    paths.push(path);
    open += 1;
    mostAtOnce = Math.max(mostAtOnce, open);
    await new Promise((r) => setTimeout(r, 0));
    open -= 1;
    const code = new URL(url).searchParams.get('query');
    const body = path.includes('ViewOptions') ? viewOptions
      : path.includes('FilterWithCache') ? { Results: [{ Identity: `id-${code}`, Name: `${code} Module` }] }
        : { CategoryEvents: [] };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  return { paths, fetchFn, mostAtOnce: () => mostAtOnce };
}

const count = (paths: string[], part: string) => paths.filter((p) => p.includes(part)).length;

describe('DCU timetable requests', () => {
  test('the modules are looked up all at once, and the calendar is asked for once', async () => {
    const dcu = fakeDCU();
    const client = new DCUAPIClient(undefined, dcu.fetchFn, new Prefs(new MemoryKV()));
    await client.weekCalendar();
    await client.eventsForModuleCodes(['EEG1001', 'EEG1002', 'EEG1004'], [week3]);
    expect(count(dcu.paths, 'FilterWithCache')).toBe(3);
    expect(dcu.mostAtOnce()).toBe(3);
    expect(count(dcu.paths, 'ViewOptions')).toBe(1);
  });

  test("a module's id is remembered across launches, so a week is one request", async () => {
    const prefs = new Prefs(new MemoryKV());
    await new DCUAPIClient(undefined, fakeDCU().fetchFn, prefs).eventsForModuleCodes(['EEG1001', 'EEG1002'], [week3]);

    const next = fakeDCU();
    const client = new DCUAPIClient(undefined, next.fetchFn, prefs);
    await client.eventsForModuleCodes(['EEG1001', 'EEG1002', 'EEG1006'], [week3]);
    // Only the new module is looked up.
    expect(next.paths.filter((p) => p.includes('FilterWithCache'))).toHaveLength(1);
    const ids = prefs.getJSON<{ ids: Record<string, string> }>(PrefKey.moduleIdentities, { ids: {} }).ids;
    expect(ids).toEqual({ EEG1001: 'id-EEG1001', EEG1002: 'id-EEG1002', EEG1006: 'id-EEG1006' });

    // The next week costs the events request alone.
    const before = next.paths.length;
    await client.eventsForModuleCodes(['EEG1001', 'EEG1002', 'EEG1006'], [week3]);
    const after = next.paths.slice(before);
    expect(after).toHaveLength(1);
    expect(after[0]).toContain('/Categories/Events/Filter/');
  });

  test("ids from another year, or old ones, are looked up again", async () => {
    const prefs = new Prefs(new MemoryKV());
    prefs.setJSON(PrefKey.moduleIdentities, { year: '2025-09-15T00:00:00+00:00', savedAt: Date.now(), ids: { EEG1001: 'last-year' } });
    const dcu = fakeDCU();
    await new DCUAPIClient(undefined, dcu.fetchFn, prefs).eventsForModuleCodes(['EEG1001'], [week3]);
    expect(count(dcu.paths, 'FilterWithCache')).toBe(1);

    prefs.setJSON(PrefKey.moduleIdentities, {
      year: '2026-09-14T00:00:00+00:00', savedAt: Date.now() - MODULE_IDENTITY_MAX_AGE_MS - 1, ids: { EEG1001: 'stale' },
    });
    const again = fakeDCU();
    await new DCUAPIClient(undefined, again.fetchFn, prefs).eventsForModuleCodes(['EEG1001'], [week3]);
    expect(count(again.paths, 'FilterWithCache')).toBe(1);
  });

  test('a failed calendar request is asked again next time, not kept', async () => {
    let fail = true;
    const fetchFn = (async () => (fail ? new Response('', { status: 503 }) : new Response(JSON.stringify(viewOptions)))) as unknown as typeof fetch;
    const client = new DCUAPIClient(undefined, fetchFn);
    await expect(client.weekCalendar()).rejects.toThrow('(503)');
    fail = false;
    await expect(client.weekCalendar()).resolves.toBeInstanceOf(WeekCalendar);
  });
});

describe('Request time limit', () => {
  afterEach(() => jest.useRealTimers());

  test('a request the server never answers is given up with a message', async () => {
    jest.useFakeTimers();
    const never = ((_: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as unknown as typeof fetch;
    const asking = withTimeLimit(never, 15_000)('https://example.com');
    const settled = expect(asking).rejects.toThrow('The server took too long to answer.');
    await jest.advanceTimersByTimeAsync(15_000);
    await settled;
  });

  test("an answer in time passes through, and a caller's own cancel isn't called a timeout", async () => {
    const ok = (async () => new Response('hi')) as unknown as typeof fetch;
    await expect((await withTimeLimit(ok)('https://example.com')).text()).resolves.toBe('hi');

    const cancelled = (async () => {
      throw new Error('cancelled by caller');
    }) as unknown as typeof fetch;
    await expect(withTimeLimit(cancelled)('https://example.com')).rejects.toThrow('cancelled by caller');
  });
});

describe('The saved week calendar', () => {
  const calendar = new WeekCalendar([{ number: 1, label: '1', firstDay: at(2026, 9, 14) }, { number: 2, label: '2', firstDay: at(2026, 9, 21) }], []);

  test('comes back as it was saved', async () => {
    const cache = new TimetableCache(new MemoryKV());
    await cache.storeCalendar(calendar);
    const back = await cache.calendar(at(2026, 9, 23));
    expect(back?.weeks).toEqual(calendar.weeks);
  });

  test("isn't used once its year is over", async () => {
    const cache = new TimetableCache(new MemoryKV());
    await cache.storeCalendar(calendar);
    expect(await cache.calendar(at(2026, 9, 28, 12))).toBeNull();
  });
});

// MARK: - The week model

const weeks: TeachingWeek[] = [
  { number: 1, label: '1', firstDay: at(2026, 9, 14) },
  { number: 2, label: '2', firstDay: at(2026, 9, 21) },
  { number: 3, label: '3', firstDay: at(2026, 9, 28) },
];
const programme: TimetableCategory = { identity: 'p', name: 'ECE1', categoryTypeIdentity: 't' };
const lecture = event('EEG1001[1]OC/L1/01', at(2026, 9, 23, 9), at(2026, 9, 23, 11), { id: 'lec' });

/** A source whose calendar and events each wait until let go, so what shows before them can be seen. */
class HeldSource implements TimetableSource {
  calendarAsked = 0;
  private releases: (() => void)[] = [];
  constructor(private readonly all: TimetableEvent[]) {}
  async searchProgrammes() { return []; }
  async weekCalendar() {
    this.calendarAsked += 1;
    await new Promise<void>((r) => this.releases.push(r));
    return new WeekCalendar(weeks, []);
  }
  async events(_c: TimetableCategory, requested: TeachingWeek[]) {
    await new Promise<void>((r) => this.releases.push(r));
    return this.all.filter((e) => requested.some((w) => e.start >= w.firstDay && e.start.getTime() < w.firstDay.getTime() + 7 * 864e5));
  }
  release() {
    for (const r of this.releases.splice(0)) r();
  }
}

async function settle() {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
}

async function servicesWithSavedWeek() {
  const kv = new MemoryKV();
  const services = await createServices({ kv, secrets: { get: async () => null, set: async () => {}, remove: async () => {} }, env: {} });
  await services.timetableCache.storeCalendar(new WeekCalendar(weeks, []));
  await services.timetableCache.store({ categoryID: 'p', weekNumber: 2, events: [lecture], fetchedAt: new Date() });
  return services;
}

describe('Opening the timetable', () => {
  afterEach(() => jest.useRealTimers());
  const now = { now: at(2026, 9, 23, 8), doNotFake: ['setTimeout', 'setImmediate', 'nextTick', 'queueMicrotask'] as const };

  test('the saved week and its deadlines show before DCU has answered anything', async () => {
    jest.useFakeTimers({ now: now.now, doNotFake: [...now.doNotFake] });
    const services = await servicesWithSavedWeek();
    const asked = jest.spyOn(services.deadlines, 'deadlinesForModules');
    const source = new HeldSource([lecture]);
    const model = new WeekModel(services, programme, source, null);
    expect(model.waitingForFirstWeek).toBe(true);

    void model.start();
    await settle();
    expect(model.weekLabel).toBe('Week 2');
    expect(model.events.map((e) => e.id)).toEqual(['lec']);
    expect(model.waitingForFirstWeek).toBe(false);
    expect(asked).toHaveBeenCalledWith(['EEG1001']);

    // The server's copy is the same, so the deadlines aren't asked for again.
    source.release();
    await settle();
    source.release();
    await settle();
    expect(source.calendarAsked).toBe(1);
    expect(asked).toHaveBeenCalledTimes(1);
  });

  test('a first launch waits on the calendar, then saves it for next time', async () => {
    jest.useFakeTimers({ now: now.now, doNotFake: [...now.doNotFake] });
    const services = await createServices({ kv: new MemoryKV(), secrets: { get: async () => null, set: async () => {}, remove: async () => {} }, env: {} });
    const source = new HeldSource([lecture]);
    const model = new WeekModel(services, programme, source, null);
    void model.start();
    await settle();
    expect(model.weeks).toEqual([]);
    expect(model.waitingForFirstWeek).toBe(true);
    for (let i = 0; i < 4; i++) {
      source.release();
      await settle();
    }
    expect(model.events.map((e) => e.id)).toEqual(['lec']);
    expect((await services.timetableCache.calendar())?.weeks).toEqual(weeks);
  });
});

describe('The deadlines tab', () => {
  // Still to come, whenever the tests run: a past deadline isn't listed.
  const soon = (days: number) => new Date(Date.now() + days * 864e5);
  const due = makeDeadline({ moduleKey: 'EEG1001', title: 'Lab report', due: soon(3), kind: 'labReport', submitterID: 'x' });
  const other = makeDeadline({ moduleKey: 'EEG9999', title: 'Not mine', due: soon(4), kind: 'other', submitterID: 'x' });

  test("shows what the timetable already has for the student's modules while it asks", async () => {
    const services = await createServices({ kv: new MemoryKV(), secrets: { get: async () => null, set: async () => {}, remove: async () => {} }, env: {} });
    let answer: (d: typeof due[]) => void = () => undefined;
    jest.spyOn(services.deadlines, 'deadlinesForModules').mockImplementation(() => new Promise((r) => (answer = r)));
    const model = new DeadlinesModel(services);
    const loading = model.load(['EEG1001'], [due, other]);
    expect(model.sections.flatMap((s) => s.deadlines.map((d) => d.title))).toEqual(['Lab report']);
    expect(model.isLoading).toBe(true);
    answer([due]);
    await loading;
    expect(model.isLoading).toBe(false);
  });

  test('an older answer landing last never replaces a newer one', async () => {
    const services = await createServices({ kv: new MemoryKV(), secrets: { get: async () => null, set: async () => {}, remove: async () => {} }, env: {} });
    const answers: ((d: typeof due[]) => void)[] = [];
    jest.spyOn(services.deadlines, 'deadlinesForModules').mockImplementation(() => new Promise((r) => answers.push(r)));
    const model = new DeadlinesModel(services);
    const first = model.load(['EEG1001']);
    const second = model.load(['EEG1001', 'EEG9999']);
    answers[1]([due, other]);
    await second;
    answers[0]([due]);
    await first;
    expect(model.sections.flatMap((s) => s.deadlines).length).toBe(2);
  });
});
