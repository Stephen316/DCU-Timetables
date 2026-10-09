import { ModuleAbbreviation, ModuleAbbreviations } from '../src/core/abbreviations';
import { TimetableAudience, TimetableChanges } from '../src/core/profile';
import { compactTitleOf, ModuleTitles, shortTitleOf, titleOf } from '../src/core/timetableEvent';
import {
  ModuleAbbreviationCache, ModuleAbbreviationRefresh, ModuleAbbreviationStore, SupabaseModuleAbbreviationStore,
} from '../src/data/abbreviations';
import { SupabaseREST } from '../src/data/rest';
import { SupabaseSession } from '../src/data/session';
import { MemoryKV, Prefs } from '../src/data/storage';
import { at, event } from './helpers';

const start = at(2026, 9, 28, 10);
const maths = event('EEG1007[1]OC/L1/01', start, undefined, { id: 'm', moduleName: 'EEG1007[1] Engineering Mathematics I' });
const profDev = event('EEG1000[1]OC/L1/01', start, undefined, { id: 'p', moduleName: 'EEG1000[1,2] Fundamentals of Professional Development' });
// Not what the app's own shortening makes of the name ("Eng. Maths I"), so a test can tell them apart.
const mathsAbbreviation: ModuleAbbreviation = { moduleKey: 'EEG1007', abbreviation: 'Maths 1' };

describe('Week-grid abbreviations', () => {
  test('replace the name on the week grid only', () => {
    const [m] = ModuleAbbreviations.apply([maths], [mathsAbbreviation]);
    expect(compactTitleOf(m)).toBe('Maths 1');
    // The day view and the class's own page keep DCU's name.
    expect(shortTitleOf(m)).toBe('Engineering Mathematics I');
    expect(titleOf(m)).toBe('EEG1007[1] Engineering Mathematics I');
  });

  test('win over a heading on the week grid, and leave the heading on the day view', () => {
    const headed = ModuleTitles.apply([profDev], [{ moduleKey: 'EEG1000', title: 'Professional Development' }]);
    const [p] = ModuleAbbreviations.apply(headed, [{ moduleKey: 'EEG1000', abbreviation: 'PD' }]);
    expect(compactTitleOf(p)).toBe('PD');
    expect(shortTitleOf(p)).toBe('Professional Development');
  });

  test('a module with none is shortened by the app as before', () => {
    const [m, p] = ModuleAbbreviations.apply([maths, profDev], [mathsAbbreviation]);
    expect(compactTitleOf(m)).toBe('Maths 1');
    expect(compactTitleOf(p)).toBe('Fund. of Prof. Dev.');
    expect(ModuleAbbreviations.apply([maths], [])[0]).toBe(maths);
  });

  test('a class added by a change keeps its own name, since abbreviations go on first', () => {
    const added = TimetableChanges.apply(ModuleAbbreviations.apply([], [mathsAbbreviation]), [{
      id: 'c1', courseKey: 'EEG1', group: null, kind: 'add', module: 'EEG1007', activityCode: null, title: 'Revision',
      dates: ['2026-09-29'], start: '14:00', end: '16:00', room: null, staff: null,
    }], TimetableAudience.forProgramme('ECE1'), at(2026, 9, 28));
    expect(added.map(compactTitleOf)).toEqual(['Revision · EEG1007']);
  });

  test('rows from the server are read defensively', () => {
    expect(ModuleAbbreviations.fromRow({ module_key: 'EEG1007', abbreviation: ' Maths 1 ' })).toEqual(mathsAbbreviation);
    // A flagged module with nothing chosen yet.
    expect(ModuleAbbreviations.fromRow({ module_key: 'EEG1017', abbreviation: null })).toBeNull();
    expect(ModuleAbbreviations.fromRow({ module_key: 'EEG1017', abbreviation: '  ' })).toBeNull();
    expect(ModuleAbbreviations.fromRow({ abbreviation: 'Maths 1' })).toBeNull();
  });
});

describe('Abbreviation refresh', () => {
  class FakeStore implements ModuleAbbreviationStore {
    failing = false;
    constructor(public list: ModuleAbbreviation[] = [mathsAbbreviation]) {}
    async abbreviations() {
      if (this.failing) throw new Error('offline');
      return this.list;
    }
  }

  test('new abbreviations are cached once, and removing the last clears them', async () => {
    const cache = new ModuleAbbreviationCache(new Prefs(new MemoryKV()));
    const store = new FakeStore();
    expect(await ModuleAbbreviationRefresh.run(store, cache)).toBe(true);
    expect(await ModuleAbbreviationRefresh.run(store, cache)).toBe(false);
    expect(cache.abbreviations()).toEqual([mathsAbbreviation]);
    store.list = [];
    expect(await ModuleAbbreviationRefresh.run(store, cache)).toBe(true);
    expect(cache.abbreviations()).toEqual([]);
  });

  test("a failed request keeps the cache: no signal mustn't put DCU's names back", async () => {
    const cache = new ModuleAbbreviationCache(new Prefs(new MemoryKV()));
    const store = new FakeStore();
    await ModuleAbbreviationRefresh.run(store, cache);
    store.failing = true;
    expect(await ModuleAbbreviationRefresh.run(store, cache)).toBe(false);
    expect(cache.abbreviations()).toEqual([mathsAbbreviation]);
  });

  test('every module is read, as the student, leaving out flagged ones with nothing to show', async () => {
    const urls: string[] = [];
    const headers: Record<string, string>[] = [];
    const fetchFn = (async (url: string, init: RequestInit = {}) => {
      urls.push(url);
      headers.push((init.headers ?? {}) as Record<string, string>);
      return new Response(JSON.stringify([{ module_key: 'EEG1007', abbreviation: 'Maths 1' }]), { status: 200 });
    }) as unknown as typeof fetch;
    const secrets = new Map<string, string>();
    const session = new SupabaseSession({
      get: async (k: string) => secrets.get(k) ?? null,
      set: async (k: string, v: string) => void secrets.set(k, v),
      remove: async (k: string) => void secrets.delete(k),
    }, () => undefined, fetchFn);
    await session.save({ accessToken: 'user-token', refreshToken: 'r', userID: 'user-1', expiresAt: Date.now() + 3_600_000 });
    const store = new SupabaseModuleAbbreviationStore(new SupabaseREST({ url: 'https://proj.supabase.co', anonKey: 'anon-key' }, session, fetchFn));

    expect(await store.abbreviations()).toEqual([mathsAbbreviation]);
    const url = new URL(urls[0]);
    expect(url.pathname).toBe('/rest/v1/module_abbreviations');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      select: 'module_key,abbreviation', abbreviation: 'not.is.null', order: 'module_key',
    });
    expect(headers[0]).toMatchObject({ Authorization: 'Bearer user-token' });
  });
});
