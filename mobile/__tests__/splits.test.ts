import { ModuleSplit, ModuleSplits, splitFromRow, surnameInitial } from '../src/core/splits';
import { DublinTime } from '../src/core/time';
import { TeachingWeek, TimetableCategory, TimetableEvent, WeekCalendar } from '../src/core/timetableEvent';
import { ModuleSplitCache, ModuleSplitRefresh, ModuleSplitStore } from '../src/data/courseData';
import { TimetableSource } from '../src/data/dcuApi';
import { createServices } from '../src/data/services';
import { MemoryKV, Prefs } from '../src/data/storage';
import { WeekModel } from '../src/features/week/WeekModel';
import { event } from './helpers';

/** A class at a Dublin wall-clock time, as DCU publishes it. */
const ev = (code: string, date: string, time: string, locations: string[] = ['L125, L126']) => {
  const start = DublinTime.date(date, time)!;
  return event(code, start, new Date(start.getTime() + 3600_000), { id: `${code}-${date}-${time}`, locations });
};

const LECTURE = 'EEG1001[1]OC/L1/01';
// Tuesday 13 and Thursday 15 October 2026 (IST).
const tueLecture = ev(LECTURE, '2026-10-13', '10:00');
const thuLecture = ev(LECTURE, '2026-10-15', '14:00');

const lectureSplit: ModuleSplit = {
  module: 'EEG1001',
  activity: 'Lecture',
  bands: [
    { from: 'A', to: 'M', day: 'Tue', start: '10:00', end: '11:00', room: null, label: null },
    { from: 'N', to: 'Z', day: 'Thu', start: '14:00', end: '15:00', room: null, label: null },
  ],
};

const ids = (list: TimetableEvent[]) => list.map((e) => e.id);

describe('Module splits', () => {
  test("hides the other band's session and keeps the student's own", () => {
    expect(ids(ModuleSplits.apply([tueLecture, thuLecture], [lectureSplit], 'H'))).toEqual([tueLecture.id]);
    expect(ids(ModuleSplits.apply([tueLecture, thuLecture], [lectureSplit], 'S'))).toEqual([thuLecture.id]);
  });

  test('both ends of a band are inside it', () => {
    expect(ids(ModuleSplits.apply([tueLecture, thuLecture], [lectureSplit], 'M'))).toEqual([tueLecture.id]);
    expect(ids(ModuleSplits.apply([tueLecture, thuLecture], [lectureSplit], 'N'))).toEqual([thuLecture.id]);
  });

  test('leaves alone what the split does not name', () => {
    const tutorial = ev('EEG1001[1]OC/T1/01', '2026-10-15', '14:00');
    const otherModule = ev('EEG1004[1]OC/L1/01', '2026-10-15', '14:00');
    const otherSlot = ev(LECTURE, '2026-10-16', '09:00');
    const week = [tutorial, otherModule, otherSlot];
    expect(ModuleSplits.apply(week, [lectureSplit], 'H')).toEqual(week);
  });

  test('an unknown initial, or one in no band, hides nothing', () => {
    const gappy: ModuleSplit = { ...lectureSplit, bands: [lectureSplit.bands[0]] };
    expect(ModuleSplits.apply([tueLecture, thuLecture], [lectureSplit], null)).toEqual([tueLecture, thuLecture]);
    expect(ModuleSplits.apply([tueLecture, thuLecture], [gappy], 'S')).toEqual([tueLecture, thuLecture]);
  });

  test("the student's band gives its room; a shared slot keeps both bands' students", () => {
    const rooms: ModuleSplit = {
      module: 'EEG1001', activity: 'lectures',
      bands: [
        { from: 'A', to: 'K', day: 'Tuesday', start: '10:00', end: '11:00', room: 'L125', label: null },
        { from: 'L', to: 'Z', day: 'Tuesday', start: '10:00', end: '11:00', room: 'L126', label: null },
      ],
    };
    expect(ModuleSplits.apply([tueLecture], [rooms], 'B')[0].locations).toEqual(['L125']);
    expect(ModuleSplits.apply([tueLecture], [rooms], 'R')[0].locations).toEqual(['L126']);
  });

  test('reads a row, padding the hour and sorting the bands', () => {
    const split = splitFromRow({
      module_key: 'EEG1001', activity: 'Lecture',
      module_split_ranges: [
        { from_letter: 'N', to_letter: 'Z', day: 'Thu', start_time: '14:00', end_time: '15:00', room: null, label: null },
        { from_letter: 'a', to_letter: 'm', day: 'Tue', start_time: '9:00', end_time: '10:00', room: ' ', label: null },
      ],
    });
    expect(split?.bands.map((b) => [b.from, b.start, b.room])).toEqual([['A', '09:00', null], ['N', '14:00', null]]);
  });

  test('refuses a row with a band it cannot place', () => {
    expect(splitFromRow({ module_key: 'EEG1001', activity: 'Lecture', module_split_ranges: [] })).toBeNull();
    expect(splitFromRow({
      module_key: 'EEG1001', activity: 'Lecture',
      module_split_ranges: [{ from_letter: 'A', to_letter: 'M', day: 'Tue', start_time: null, end_time: '11:00' }],
    })).toBeNull();
  });

  test('a surname sorts by its first letter', () => {
    expect(surnameInitial('Harcourt')).toBe('H');
    expect(surnameInitial('obrien')).toBe('O');
    expect(surnameInitial('')).toBeNull();
    expect(surnameInitial(undefined)).toBeNull();
  });
});

describe('Module split refresh', () => {
  class FakeSplitStore implements ModuleSplitStore {
    failing = false;
    constructor(public list: ModuleSplit[] = [lectureSplit]) {}
    async splits() {
      if (this.failing) throw new Error('offline');
      return this.list;
    }
  }

  test('new splits are cached once', async () => {
    const cache = new ModuleSplitCache(new Prefs(new MemoryKV()));
    const store = new FakeSplitStore();
    expect(await ModuleSplitRefresh.run(store, cache)).toBe(true);
    expect(await ModuleSplitRefresh.run(store, cache)).toBe(false);
    expect(cache.splits()).toEqual([lectureSplit]);
  });

  test('a failed request keeps the cache', async () => {
    const cache = new ModuleSplitCache(new Prefs(new MemoryKV()));
    const store = new FakeSplitStore();
    await ModuleSplitRefresh.run(store, cache);
    store.failing = true;
    expect(await ModuleSplitRefresh.run(store, cache)).toBe(false);
    expect(cache.splits()).toEqual([lectureSplit]);
  });

  test('deleting the last split clears it', async () => {
    const cache = new ModuleSplitCache(new Prefs(new MemoryKV()));
    const store = new FakeSplitStore();
    await ModuleSplitRefresh.run(store, cache);
    store.list = [];
    expect(await ModuleSplitRefresh.run(store, cache)).toBe(true);
    expect(cache.splits()).toEqual([]);
  });
});

describe('Week model with a split', () => {
  const week: TeachingWeek = { number: 5, label: '5', firstDay: DublinTime.date('2026-10-12', '00:00')! };
  const source: TimetableSource = {
    searchProgrammes: async () => [],
    weekCalendar: async () => new WeekCalendar([week], []),
    events: async () => [tueLecture, thuLecture],
  };
  const programme: TimetableCategory = { identity: 'p', name: 'ECE1 (Electronic Eng)', categoryTypeIdentity: 't' };

  async function model(address: string) {
    const services = await createServices({ kv: new MemoryKV(), secrets: { get: async () => null, set: async () => {}, remove: async () => {} }, env: {} });
    services.user.save({ id: 'u1', address });
    return { services, model: new WeekModel(services, programme, source, null, new Set()) };
  }

  test("shows only the signed-in student's band, and re-applies when the splits change", async () => {
    const { services, model: m } = await model('stephen.harcourt2@mail.dcu.ie');
    await m.start();
    expect(ids(m.events)).toEqual([tueLecture.id, thuLecture.id]);

    services.splitCache.store([lectureSplit]);
    m.reloadSplits();
    expect(ids(m.events)).toEqual([tueLecture.id]);

    services.splitCache.store([]);
    m.reloadSplits();
    expect(ids(m.events)).toEqual([tueLecture.id, thuLecture.id]);
  });

  test('a split already cached applies from the first load', async () => {
    const { services } = await model('niamh.smith@mail.dcu.ie');
    services.splitCache.store([lectureSplit]);
    const m = new WeekModel(services, programme, source, null, new Set());
    await m.start();
    expect(ids(m.events)).toEqual([thuLecture.id]);
  });
});
