import { DeadlineRules } from '../src/core/deadline';
import { TimetableAudience, TimetableChanges } from '../src/core/profile';
import { compactTitleOf, ModuleTitle, ModuleTitles, shortTitleOf, titleOf } from '../src/core/timetableEvent';
import { ModuleTitleCache, ModuleTitleRefresh, ModuleTitleStore } from '../src/data/courseData';
import { MemoryKV, Prefs } from '../src/data/storage';
import { at, event } from './helpers';

const start = at(2026, 9, 28, 10);
const materials = event('EEG1006[1]OC/L1/01', start, undefined, { id: 'm', moduleName: 'EEG1006[1] Materials Engineering' });
const profDev = event('EEG1000[1]OC/L1/01', start, undefined, { id: 'p', moduleName: 'EEG1000[1,2] Fundamentals of Professional Development' });
const materialsHeading: ModuleTitle = { moduleKey: 'EEG1006', title: 'Materials' };
const profDevHeading: ModuleTitle = { moduleKey: 'EEG1000', title: 'Professional Development' };

describe('Module headings', () => {
  test("replace DCU's name on the day view and week grid, but not on the class's own page", () => {
    const [m, p] = ModuleTitles.apply([materials, profDev], [materialsHeading, profDevHeading]);
    expect(shortTitleOf(m)).toBe('Materials');
    expect(compactTitleOf(m)).toBe('Materials');
    expect(shortTitleOf(p)).toBe('Professional Development');
    expect(titleOf(p)).toBe('EEG1000[1,2] Fundamentals of Professional Development');
  });

  test('a heading is shortened on the week grid like any name', () => {
    // The week grid's own names come from the Abbreviations page (abbreviations.test.ts).
    const [p] = ModuleTitles.apply([profDev], [profDevHeading]);
    expect(compactTitleOf(p)).toBe('Prof. Dev.');
    const [e] = ModuleTitles.apply([materials], [{ moduleKey: 'EEG1006', title: 'Materials Engineering Lab' }]);
    expect(compactTitleOf(e)).toBe('Materials Eng. Lab');
  });

  test('a module with no heading keeps its own name', () => {
    const [m, p] = ModuleTitles.apply([materials, profDev], [profDevHeading]);
    expect(shortTitleOf(m)).toBe('Materials Engineering');
    expect(shortTitleOf(p)).toBe('Professional Development');
    expect(ModuleTitles.apply([materials], [])[0]).toBe(materials);
  });

  test("an added class keeps its own name, since headings go on before changes", () => {
    const added = TimetableChanges.apply(ModuleTitles.apply([], [materialsHeading]), [{
      id: 'c1', courseKey: 'EEG1', group: null, kind: 'add', module: 'EEG1006', activityCode: null, title: 'Make-up lab',
      dates: ['2026-09-29'], start: '14:00', end: '16:00', room: null, staff: null,
    }], TimetableAudience.forProgramme('ECE1'), at(2026, 9, 28));
    expect(added.map(shortTitleOf)).toEqual(['Make-up lab · EEG1006']);
  });

  test('deadlines name the module by its heading', () => {
    const names = DeadlineRules.moduleNames(ModuleTitles.apply([materials], [materialsHeading]));
    expect(names.get('EEG1006')).toBe('Materials');
  });

  test('rows from the server are read defensively', () => {
    expect(ModuleTitles.fromRow({ module_key: 'EEG1006', title: ' Materials ' }))
      .toEqual({ moduleKey: 'EEG1006', title: 'Materials' });
    expect(ModuleTitles.fromRow({ module_key: 'EEG1006', title: '   ' })).toBeNull();
    expect(ModuleTitles.fromRow({ title: 'Materials' })).toBeNull();
  });
});

describe('Module heading refresh', () => {
  class FakeTitleStore implements ModuleTitleStore {
    failing = false;
    constructor(public list: ModuleTitle[] = [materialsHeading]) {}
    async titles() {
      if (this.failing) throw new Error('offline');
      return this.list;
    }
  }

  test('new headings are cached once, and deleting the last clears it', async () => {
    const cache = new ModuleTitleCache(new Prefs(new MemoryKV()));
    const store = new FakeTitleStore();
    expect(await ModuleTitleRefresh.run(store, cache)).toBe(true);
    expect(await ModuleTitleRefresh.run(store, cache)).toBe(false);
    expect(cache.titles()).toEqual([materialsHeading]);
    store.list = [];
    expect(await ModuleTitleRefresh.run(store, cache)).toBe(true);
    expect(cache.titles()).toEqual([]);
  });

  test("a failed request keeps the cache: no signal mustn't put DCU's names back", async () => {
    const cache = new ModuleTitleCache(new Prefs(new MemoryKV()));
    const store = new FakeTitleStore();
    await ModuleTitleRefresh.run(store, cache);
    store.failing = true;
    expect(await ModuleTitleRefresh.run(store, cache)).toBe(false);
    expect(cache.titles()).toEqual([materialsHeading]);
  });
});
