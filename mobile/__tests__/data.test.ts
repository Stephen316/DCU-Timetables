import bundledJSON from '../assets/data/EngineeringLabRotation.json';
import { CancellationStatus } from '../src/core/cancellation';
import { makeDeadline } from '../src/core/deadline';
import {
  allocationFromRow, changeFromRow, cohortCourseKey, cohortForCourseKey, decodeProfile, labSessionID, LabRotation,
  LabRotations, LabSession, makeChange, makeProfile, profileFromAllocation, TimetableAudience, TimetableChanges,
} from '../src/core/profile';
import { DublinTime } from '../src/core/time';
import {
  AllocationRefresh, AllocationResolution, AllocationStore, decodeResolution, decodeSavedRotation, LabRotationCache,
  LabRotationRefresh, LabRotationStore, RosterSummary, SavedLabRotation, TimetableChangeCache, TimetableChangeRefresh,
  TimetableChangeStore,
} from '../src/data/courseData';
import { EventMapper, EventsResponseDTO } from '../src/data/dcuApi';
import { buildQuery, PostgREST } from '../src/data/rest';
import { isSessionValid, parseAuthSession, SupabaseSession } from '../src/data/session';
import { MemoryKV, Prefs } from '../src/data/storage';
import { LocalCancellationStore, LocalDeadlineStore } from '../src/data/stores';
import { deadlineSFSymbol, WidgetSnapshotPublisher } from '../src/data/widgets';
import { at, event, utc } from './helpers';

const newPrefs = () => new Prefs(new MemoryKV());

describe('Allocation resolution', () => {
  test('matched carries key and version', () => {
    expect(decodeResolution([{ status: 'matched', allocation_key: 'ab12', version: 3 }])).toEqual({ kind: 'matched', key: 'ab12', version: 3 });
  });

  test('reads every other status', () => {
    expect(decodeResolution([{ status: 'ambiguous', allocation_key: null, version: 1 }]).kind).toBe('ambiguous');
    expect(decodeResolution([{ status: 'none', allocation_key: null, version: 1 }]).kind).toBe('notListed');
    expect(decodeResolution([{ status: 'conflict', allocation_key: null, version: 1 }]).kind).toBe('conflict');
    expect(decodeResolution([{ status: 'no_roster', allocation_key: null, version: null }]).kind).toBe('noRoster');
  });

  test('unknown or incomplete answers are not matches', () => {
    expect(decodeResolution([{ status: 'something_new', allocation_key: 'ab', version: 1 }]).kind).toBe('notListed');
    expect(decodeResolution([{ status: 'matched', allocation_key: null, version: 1 }]).kind).toBe('notListed');
    expect(decodeResolution([]).kind).toBe('notListed');
  });

  test('allocation decodes the table column names', () => {
    expect(allocationFromRow({ grp: 'B', subgroup: 'B.3', day: 'Wed', workshop: 'SG24', drawing: 'SB38' }))
      .toEqual({ group: 'B', subgroup: 'B.3', day: 'Wed', workshop: 'SG24', drawing: 'SB38' });
  });

  test('a profile saved before the server matched them still decodes', () => {
    const p = decodeProfile({ name: 'Student Example', cohort: 'engineeringYear1', group: 'C', subgroup: 'C.2', workshop: 'SG25', drawing: 'SB39' });
    expect(p?.group).toBe('C');
    expect(p?.courseKey).toBeNull();
    expect(p?.rosterVersion).toBeNull();
  });

  test("the cohort maps to the console's programme key", () => {
    expect(cohortCourseKey('engineeringYear1')).toBe('EEG1');
    expect(cohortForCourseKey('EEG1')).toBe('engineeringYear1');
    expect(cohortForCourseKey('CASE3')).toBeNull();
  });
});

class FakeAllocationStore implements AllocationStore {
  rosterList: RosterSummary[];
  failing = false;
  resolveCalls = 0;

  constructor(version: number, public resolution: AllocationResolution = { kind: 'notListed' }, public row: ReturnType<typeof allocationFromRow> = null) {
    this.rosterList = [{ courseKey: 'EEG1', title: 'Engineering — Year 1', version }];
  }
  async rosters() {
    if (this.failing) throw new Error('offline');
    return this.rosterList;
  }
  async resolve() {
    this.resolveCalls++;
    return this.resolution;
  }
  async allocation() { return this.row; }
  async subgroups() { return []; }
}

describe('Allocation refresh', () => {
  const profile = profileFromAllocation('Student Example', 'engineeringYear1',
    { group: 'A', subgroup: 'A.1', day: null, workshop: 'SG23', drawing: 'SB39' }, 'aa', 2);
  const alloc = (group: string, subgroup: string, workshop: string, drawing: string) => ({ group, subgroup, day: null, workshop, drawing });

  test('same version is not resolved again', async () => {
    const store = new FakeAllocationStore(2);
    expect(await AllocationRefresh.check(profile, store)).toEqual({ kind: 'unchanged' });
    expect(store.resolveCalls).toBe(0);
  });

  test('a new version replaces the allocation', async () => {
    const store = new FakeAllocationStore(3, { kind: 'matched', key: 'bb', version: 3 }, alloc('B', 'B.2', 'SG24', 'SB38'));
    const result = await AllocationRefresh.check(profile, store);
    if (result.kind !== 'updated') throw new Error('expected an update');
    expect(result.profile).toMatchObject({ group: 'B', drawing: 'SB38', rosterVersion: 3, name: profile.name });
  });

  test('removed from the list drops the profile', async () => {
    expect((await AllocationRefresh.check(profile, new FakeAllocationStore(3, { kind: 'notListed' }))).kind).toBe('dropped');
    expect((await AllocationRefresh.check(profile, new FakeAllocationStore(3, { kind: 'conflict' }))).kind).toBe('dropped');
  });

  test('a deleted roster drops the profile', async () => {
    const store = new FakeAllocationStore(2);
    store.rosterList = [];
    expect((await AllocationRefresh.check(profile, store)).kind).toBe('dropped');
  });

  test('a network failure keeps the profile', async () => {
    const store = new FakeAllocationStore(3);
    store.failing = true;
    expect((await AllocationRefresh.check(profile, store)).kind).toBe('unchanged');
  });

  test('profiles from before the server are left alone', async () => {
    const store = new FakeAllocationStore(9);
    expect((await AllocationRefresh.check(makeProfile({ name: 'Student Example', group: 'D' }), store)).kind).toBe('unchanged');
    expect(store.resolveCalls).toBe(0);
  });

  test('a picked programme moves onto a new list', async () => {
    const store = new FakeAllocationStore(1, { kind: 'matched', key: 'cc', version: 1 }, alloc('C', 'C.3', 'SG23', 'SB39'));
    const result = await AllocationRefresh.adopt('Student Example', {}, store);
    if (result.kind !== 'adopted') throw new Error('expected adoption');
    expect(result.profile).toMatchObject({ group: 'C', courseKey: 'EEG1', rosterVersion: 1, name: 'Student Example' });
  });

  test('a list already asked about is not asked again', async () => {
    const store = new FakeAllocationStore(4, { kind: 'conflict' });
    expect(await AllocationRefresh.adopt('', {}, store)).toEqual({ kind: 'stay', tried: { EEG1: 4 } });
    expect(await AllocationRefresh.adopt('', { EEG1: 4 }, store)).toEqual({ kind: 'stay', tried: { EEG1: 4 } });
    expect(store.resolveCalls).toBe(1);
  });

  test('a corrected list is asked about again', async () => {
    const store = new FakeAllocationStore(5, { kind: 'notListed' });
    expect(await AllocationRefresh.adopt('', { EEG1: 4 }, store)).toEqual({ kind: 'stay', tried: { EEG1: 5 } });
    expect(store.resolveCalls).toBe(1);
  });

  test('a shared name stays on the picked programme', async () => {
    expect(await AllocationRefresh.adopt('', {}, new FakeAllocationStore(1, { kind: 'ambiguous' }))).toEqual({ kind: 'stay', tried: { EEG1: 1 } });
  });

  test('offline leaves the list to be asked about later', async () => {
    const store = new FakeAllocationStore(1);
    store.failing = true;
    expect(await AllocationRefresh.adopt('', {}, store)).toEqual({ kind: 'stay', tried: {} });
  });

  test("a list for a course the app can't show is ignored", async () => {
    const store = new FakeAllocationStore(1, { kind: 'matched', key: 'dd', version: 1 }, alloc('A', '', '', ''));
    store.rosterList = [{ courseKey: 'CASE3', title: null, version: 1 }];
    expect(await AllocationRefresh.adopt('', {}, store)).toEqual({ kind: 'stay', tried: {} });
    expect(store.resolveCalls).toBe(0);
  });
});

describe('Lab rotation', () => {
  const rotation = LabRotations.decode({
    title: 't',
    modules: { EEG1001: { name: 'Project & Technical Drawing' }, EEG1004: { name: 'Introduction to Electronics' }, EEG1002: { name: 'Programming' } },
    sessions: [
      { week: 3, date: '2026-09-22', day: 'Tue', start: '14:00', end: '17:00', module: 'EEG1001', activity: 'Workshop', groups: ['B'] },
      { week: 3, date: '2026-09-22', day: 'Tue', start: '14:00', end: '17:00', module: 'EEG1001', activity: 'Drawing', groups: ['A'] },
      { week: 3, date: '2026-09-24', day: 'Thu', start: '14:00', end: '17:00', module: 'EEG1004', activity: 'Lab', groups: ['A', 'B', 'E'] },
      { week: 2, date: '2026-09-17', day: 'Thu', start: '14:00', end: '17:00', module: 'EEG1002', activity: 'Lab', groups: ['A', 'B', 'E'] },
      { week: 3, date: '2026-09-25', day: 'Fri', start: '09:00', end: '12:00', module: 'EEG1004', activity: 'Lab', groups: ['C', 'D'] },
      { week: 3, date: '2026-09-24', day: 'Thu', start: '14:00', end: '17:00', module: 'EEG1001', activity: 'Drawing', groups: ['C'] },
    ],
  })!;

  test('lists group letters', () => expect(LabRotations.groupLetters(rotation)).toEqual(['A', 'B', 'C', 'D', 'E']));

  test('filters sessions for a group in schedule order', () => {
    const a = LabRotations.sessionsForGroup(rotation, 'A');
    expect(a.map((s) => s.date)).toEqual(['2026-09-17', '2026-09-22', '2026-09-24']);
  });

  test('orders by day before time of day', () => {
    expect(LabRotations.sessionsForGroup(rotation, 'C').map((s) => s.day)).toEqual(['Thu', 'Fri']);
  });

  test('exposes module names', () => {
    expect(LabRotations.name(rotation, 'EEG1004')).toBe('Introduction to Electronics');
    expect(LabRotations.moduleCodes(rotation)).toEqual(new Set(['EEG1001', 'EEG1002', 'EEG1004']));
  });

  test('one module runs two activities in one afternoon', () => {
    const tuesday = rotation.sessions.filter((s) => s.date === '2026-09-22');
    expect(tuesday.map((s) => s.module)).toEqual(['EEG1001', 'EEG1001']);
    expect(new Set(tuesday.map(labSessionID)).size).toBe(2);
  });

  test('refuses a session without an activity', () => {
    expect(LabRotations.decode({ title: 't', modules: {}, sessions: [
      { week: 2, date: '2026-09-17', day: 'Thu', start: '14:00', end: '17:00', module: 'EEG1002', groups: ['A'] },
    ] })).toBeNull();
  });

  describe('the bundled rotation matches the School PDF', () => {
    const bundled = LabRotations.decode(bundledJSON)!;

    test('loads every session with distinct ids', () => {
      expect(bundled.sessions).toHaveLength(67);
      expect(new Set(bundled.sessions.map(labSessionID)).size).toBe(67);
    });

    test('each column belongs to the module over it', () => {
      for (const s of bundled.sessions) {
        if (s.activity === 'Workshop' || s.activity === 'Drawing') expect(s.module).toBe('EEG1001');
        else if (s.activity === 'Lab') expect(['EEG1004', 'EEG1002']).toContain(s.module);
        else throw new Error(`unexpected activity ${s.activity}`);
      }
    });

    test('the two labs alternate fortnightly', () => {
      const weeks = (m: string) => new Set(bundled.sessions.filter((s) => s.module === m && s.activity === 'Lab').map((s) => s.week));
      expect(weeks('EEG1004')).toEqual(new Set([3, 5, 7, 9, 11]));
      expect(weeks('EEG1002')).toEqual(new Set([2, 4, 6, 8, 10, 12]));
    });

    test("Wednesdays are group E's workshop", () => {
      const wednesdays = bundled.sessions.filter((s) => s.day === 'Wed');
      expect(wednesdays).toHaveLength(5);
      expect(wednesdays.every((s) => s.module === 'EEG1001' && s.activity === 'Workshop' && s.groups.join() === 'E')).toBe(true);
    });

    test('Thursday 24 September matches the PDF', () => {
      const cells = new Set(bundled.sessions.filter((s) => s.date === '2026-09-24').map((s) => `${s.module} ${s.activity} ${s.groups.join('')}`));
      expect(cells).toEqual(new Set(['EEG1001 Workshop D', 'EEG1001 Drawing C', 'EEG1004 Lab ABE']));
    });
  });
});

describe('Saved lab rotation', () => {
  test('decodes the embedded sessions', () => {
    const saved = decodeSavedRotation([{ version: 3, title: 'Semester 1', lab_rotation_sessions: [
      { week: 2, date: '2026-09-17', day: 'Thu', start_time: '14:00', end_time: '17:00', module: 'EEG1002', activity: 'Lab', groups: ['A', 'B', 'E'] },
    ] }]);
    expect(saved?.version).toBe(3);
    expect(saved?.sessions).toEqual([{ week: 2, date: '2026-09-17', day: 'Thu', start: '14:00', end: '17:00', module: 'EEG1002', activity: 'Lab', groups: ['A', 'B', 'E'] }]);
  });

  test('nothing saved is null', () => expect(decodeSavedRotation([])).toBeNull());

  test('unplaceable sessions are left out', () => {
    const saved = decodeSavedRotation([{ version: 1, title: null, lab_rotation_sessions: [
      { week: 2, date: null, day: 'Thu', start_time: '14:00', end_time: '17:00', module: 'EEG1002', activity: 'Lab', groups: ['A'] },
      { week: 2, date: '2026-09-17', day: 'Thu', start_time: '14:00', end_time: '17:00', module: 'EEG1002', activity: 'Lab', groups: [] },
      { week: 2, date: '2026-09-17', day: 'Thu', start_time: '14:00', end_time: '17:00', module: 'EEG1002', activity: null, groups: ['C'] },
    ] }]);
    expect(saved?.sessions).toHaveLength(1);
    expect(saved?.sessions[0].activity).toBe('');
  });
});

class FakeRotationStore implements LabRotationStore {
  failing = false;
  rotationCalls = 0;
  constructor(public saved: SavedLabRotation | null) {}
  async version() {
    if (this.failing) throw new Error('offline');
    return this.saved?.version ?? null;
  }
  async rotation() {
    this.rotationCalls++;
    return this.saved;
  }
}

describe('Lab rotation refresh', () => {
  const session: LabSession = { week: 5, date: '2026-10-08', day: 'Thu', start: '14:00', end: '17:00', module: 'EEG1002', activity: 'Lab', groups: ['C'] };
  const bundled: LabRotation = { title: 'Bundled', modules: { EEG1002: { name: 'EEG1002 Programming' } }, sessions: [] };
  const saved = (sessions: LabSession[] = [session]): SavedLabRotation => ({ version: 2, title: null, sessions });

  test('a new version is downloaded with bundled names', async () => {
    const cache = new LabRotationCache(newPrefs());
    expect(await LabRotationRefresh.run('EEG1', new FakeRotationStore(saved()), cache, bundled)).toBe(true);
    const entry = cache.entry('EEG1');
    expect(entry?.version).toBe(2);
    expect(entry?.rotation.sessions).toEqual([session]);
    expect(LabRotations.name(entry!.rotation, 'EEG1002')).toBe('EEG1002 Programming');
    expect(entry?.rotation.title).toBe('Bundled');
  });

  test('the same version is not downloaded again', async () => {
    const cache = new LabRotationCache(newPrefs());
    const store = new FakeRotationStore(saved());
    await LabRotationRefresh.run('EEG1', store, cache, bundled);
    expect(await LabRotationRefresh.run('EEG1', store, cache, bundled)).toBe(false);
    expect(store.rotationCalls).toBe(1);
  });

  test('a failed request keeps the cached rotation', async () => {
    const cache = new LabRotationCache(newPrefs());
    const store = new FakeRotationStore(saved());
    await LabRotationRefresh.run('EEG1', store, cache, bundled);
    store.failing = true;
    expect(await LabRotationRefresh.run('EEG1', store, cache, bundled)).toBe(false);
    expect(cache.entry('EEG1')?.version).toBe(2);
  });

  test('deleted in the console falls back to bundled', async () => {
    const cache = new LabRotationCache(newPrefs());
    const store = new FakeRotationStore(saved());
    await LabRotationRefresh.run('EEG1', store, cache, bundled);
    store.saved = null;
    expect(await LabRotationRefresh.run('EEG1', store, cache, bundled)).toBe(true);
    expect(cache.entry('EEG1')).toBeNull();
  });

  test('an empty rotation is not cached', async () => {
    const cache = new LabRotationCache(newPrefs());
    expect(await LabRotationRefresh.run('EEG1', new FakeRotationStore(saved([])), cache, bundled)).toBe(false);
    expect(cache.entry('EEG1')).toBeNull();
  });
});

describe('Timetable changes', () => {
  /** 14:00 Dublin on 14 Oct 2026 (IST, UTC+1) — DCU sends it as 13:00 UTC. */
  const ev = (code: string, date: string, time: string) => {
    const start = DublinTime.date(date, time)!;
    return event(code, start, new Date(start.getTime() + 3 * 3600_000), { id: `${code}-${date}-${time}` });
  };
  const lab = 'EEG1002[1]OC/P1/02';
  const otherLab = 'EEG1002[1]OC/P1/01';
  const groupC = new TimetableAudience('EEG1', 'C', 'C.2');
  const remove = (fields: { group?: string; code?: string; course?: string } = {}) =>
    makeChange({ id: Math.random().toString(), courseKey: fields.course ?? 'EEG1', group: fields.group ?? null, kind: 'remove',
      module: 'EEG1002', activityCode: fields.code ?? null, dates: ['2026-10-14'], start: '14:00' });

  test('a removal for the group hides the class', () => {
    const week = [ev(lab, '2026-10-14', '14:00'), ev(lab, '2026-10-21', '14:00')];
    expect(TimetableChanges.apply(week, [remove({ group: 'C' })], groupC, null).map((e) => e.id)).toEqual([week[1].id]);
  });

  test('a removal for another group leaves it alone', () => {
    const week = [ev(lab, '2026-10-14', '14:00')];
    expect(TimetableChanges.apply(week, [remove({ group: 'D' })], groupC, null)).toEqual(week);
  });

  test('a subgroup removal reaches only that subgroup', () => {
    const week = [ev(lab, '2026-10-14', '14:00')];
    expect(TimetableChanges.apply(week, [remove({ group: 'C.2' })], groupC, null)).toEqual([]);
    expect(TimetableChanges.apply(week, [remove({ group: 'C.1' })], groupC, null)).toEqual(week);
  });

  test('no group sees only changes for everyone', () => {
    const week = [ev(lab, '2026-10-14', '14:00')];
    const picked = new TimetableAudience('EEG1');
    expect(TimetableChanges.apply(week, [remove({ group: 'C' })], picked, null)).toEqual(week);
    expect(TimetableChanges.apply(week, [remove()], picked, null)).toEqual([]);
  });

  test("another course's changes don't apply", () => {
    const week = [ev(lab, '2026-10-14', '14:00')];
    expect(TimetableChanges.apply(week, [remove({ course: 'CASE1' })], groupC, null)).toEqual(week);
  });

  test('an activity code narrows the removal', () => {
    const week = [ev(lab, '2026-10-14', '14:00'), ev(otherLab, '2026-10-14', '14:00')];
    expect(TimetableChanges.apply(week, [remove({ code: lab })], groupC, null).map((e) => e.id)).toEqual([week[1].id]);
  });

  test('the code ignores the week suffix', () => {
    expect(TimetableChanges.apply([ev(`${lab} <2, 4, 6>`, '2026-10-14', '14:00')], [remove({ code: lab })], groupC, null)).toEqual([]);
  });

  test('a different start is not removed', () => {
    const week = [ev(lab, '2026-10-14', '09:00')];
    expect(TimetableChanges.apply(week, [remove()], groupC, null)).toEqual(week);
  });

  test('an addition lands in its week only', () => {
    const add = makeChange({ id: 'a1', courseKey: 'EEG1', group: 'C', kind: 'add', module: 'EEG1004', title: 'Make-up lab',
      dates: ['2026-10-16', '2026-10-23'], start: '10:00', end: '12:00', room: 'S205' });
    const out = TimetableChanges.apply([], [add], groupC, DublinTime.date('2026-10-12', '00:00'));
    expect(out).toHaveLength(1);
    expect(out[0].start).toEqual(DublinTime.date('2026-10-16', '10:00'));
    expect(out[0].locations).toEqual(['S205']);
    expect(out[0].activity.moduleCode).toBe('EEG1004');
    expect(DublinTime.timeString(out[0].start)).toBe('10:00');
  });

  test('no audience changes nothing', () => {
    const week = [ev(lab, '2026-10-14', '14:00')];
    expect(TimetableChanges.apply(week, [remove()], null, null)).toEqual(week);
  });

  test('picked Engineering programmes map to their course', () => {
    expect(TimetableAudience.forProgramme('ECE1')?.courseKey).toBe('EEG1');
    expect(TimetableAudience.forProgramme('CASE3')).toBeNull();
  });

  test('decodes a row', () => {
    const row = changeFromRow({ id: 'x', course_key: 'EEG1', grp: null, kind: 'remove', module: 'EEG1002', activity_code: null,
      title: null, dates: ['2026-10-14'], start_time: '14:00', end_time: null, room: null });
    expect(row?.group).toBeNull();
    expect(row?.kind).toBe('remove');
  });

  class FakeChangeStore implements TimetableChangeStore {
    failing = false;
    constructor(public list = [makeChange({ id: '1', courseKey: 'EEG1', kind: 'remove', module: 'EEG1002', dates: ['2026-10-14'], start: '14:00' })]) {}
    async changes() {
      if (this.failing) throw new Error('offline');
      return this.list;
    }
  }

  test('new changes are cached once', async () => {
    const cache = new TimetableChangeCache(newPrefs());
    const store = new FakeChangeStore();
    expect(await TimetableChangeRefresh.run('EEG1', store, cache)).toBe(true);
    expect(await TimetableChangeRefresh.run('EEG1', store, cache)).toBe(false);
    expect(cache.changes('EEG1')).toEqual(store.list);
  });

  test('a failed request keeps the cache', async () => {
    const cache = new TimetableChangeCache(newPrefs());
    const store = new FakeChangeStore();
    await TimetableChangeRefresh.run('EEG1', store, cache);
    store.failing = true;
    expect(await TimetableChangeRefresh.run('EEG1', store, cache)).toBe(false);
    expect(cache.changes('EEG1')).toEqual(store.list);
  });

  test('deleting the last change clears it', async () => {
    const cache = new TimetableChangeCache(newPrefs());
    const store = new FakeChangeStore();
    await TimetableChangeRefresh.run('EEG1', store, cache);
    store.list = [];
    expect(await TimetableChangeRefresh.run('EEG1', store, cache)).toBe(true);
    expect(cache.changes('EEG1')).toEqual([]);
  });
});

describe('DCU API mapping', () => {
  const fixture: EventsResponseDTO = JSON.parse(`{"CategoryEvents":[{"Identity":"cat","Name":"AC1","Results":[
    {"Identity":"e1","StartDateTime":"2026-09-15T13:30:00+00:00","EndDateTime":"2026-09-15T15:00:00+00:00",
     "EventType":"On Campus","Location":"GLA.T101, GLA.HG22","Name":"BIO1000[1]OC/L1/01 Surname A - M",
     "ExtraProperties":[{"Name":"Module Name","Value":"BIO1000[1] How life works 1"},{"Name":"Staff Member","Value":"Tejada, A"}],"WeekLabels":"2"},
    {"Identity":"e2","StartDateTime":"2026-09-15T18:00:00+00:00","EndDateTime":"2026-09-15T20:00:00+00:00",
     "EventType":"Asynchronous (Recorded)","Location":null,"Name":"MTH1033[1]AY/L1/01",
     "ExtraProperties":[{"Name":"Module Name","Value":"MTH1033 Calculus"}],"WeekLabels":"2"}
  ]}],"BookingRequests":null,"PersonalEvents":null}`);

  test('maps events from a response', () => {
    const events = EventMapper.events(fixture);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      moduleName: 'BIO1000[1] How life works 1', locations: ['GLA.T101', 'GLA.HG22'], type: 'onCampus',
      staff: ['Tejada, A'], weekLabels: ['2'], start: utc(2026, 9, 15, 13, 30),
    });
    expect(events[0].activity.moduleCode).toBe('BIO1000');
    expect(events[0].activity.kind).toBe('L');
    expect(events[1].type).toBe('asynchronous');
    expect(events[1].locations).toEqual([]);
    expect(events[1].staff).toEqual([]);
  });

  test('parses multi-room and empty locations', () => {
    expect(EventMapper.locations('GLA.T101, GLA.HG22')).toEqual(['GLA.T101', 'GLA.HG22']);
    expect(EventMapper.locations(null)).toEqual([]);
    expect(EventMapper.locations('')).toEqual([]);
  });
});

describe('PostgREST quoting', () => {
  test('in-lists quote every value and strip embedded quotes', () => {
    expect(PostgREST.inList(['a,b', 'c"d'])).toBe('in.("a,b","cd")');
  });

  test('query values are percent-encoded, spaces included', () => {
    expect(buildQuery([['event_key', 'eq.BIO1000[1]OC/L1/01 Surname A - M|2026-09-15T13:30:00Z']]))
      .toBe('event_key=eq.BIO1000%5B1%5DOC%2FL1%2F01%20Surname%20A%20-%20M%7C2026-09-15T13%3A30%3A00Z');
  });
});

describe('Auth session', () => {
  const json = { access_token: 'access-123', refresh_token: 'refresh-456', expires_in: 3600, user: { id: 'user-789' } };

  test('reads tokens and expiry', () => {
    const s = parseAuthSession(json, 1_000_000_000);
    expect(s).toEqual({ accessToken: 'access-123', refreshToken: 'refresh-456', userID: 'user-789', expiresAt: 1_000_000_000 + 3_600_000 });
  });

  test('prefers an absolute expiry when given', () => {
    expect(parseAuthSession({ ...json, expires_at: 2_000_000 }, 1_000_000_000)?.expiresAt).toBe(2_000_000_000);
  });

  test('no session without tokens', () => {
    expect(parseAuthSession({ user: { id: 'user-789' } })).toBeNull();
    expect(parseAuthSession({ access_token: 'a', refresh_token: 'b' })).toBeNull();
  });

  test('tokens about to expire count as expired', () => {
    const now = Date.now();
    const s = (seconds: number) => ({ accessToken: 'a', refreshToken: 'b', userID: 'u', expiresAt: now + seconds * 1000 });
    expect(isSessionValid(s(300), now)).toBe(true);
    expect(isSessionValid(s(30), now)).toBe(false);
    expect(isSessionValid(s(-10), now)).toBe(false);
  });

  test('a dead refresh token signs the student out and says so', async () => {
    const secrets = new Map<string, string>();
    const store = { get: async (k: string) => secrets.get(k) ?? null, set: async (k: string, v: string) => void secrets.set(k, v), remove: async (k: string) => void secrets.delete(k) };
    let expired = 0;
    const fetchFn = jest.fn(async () => new Response('{}', { status: 400 }));
    const session = new SupabaseSession(store, () => expired++, fetchFn as unknown as typeof fetch);
    await session.save({ accessToken: 'a', refreshToken: 'dead', userID: 'u', expiresAt: Date.now() - 1000 });
    expect(await session.accessToken({ url: 'https://x.supabase.co', anonKey: 'anon' })).toBeNull();
    expect(expired).toBe(1);
    expect(session.userID).toBeNull();
    expect(secrets.size).toBe(0);
  });
});

describe('Device storage', () => {
  test('prefs survive a relaunch', async () => {
    const kv = new MemoryKV();
    const first = new Prefs(kv);
    first.setJSON('hiddenGroups', ['a', 'b']);
    first.set('studentID', 'A12345678');
    first.set('studentID', null);
    await first.flushed();
    const second = new Prefs(kv);
    await second.hydrate();
    expect(second.getJSON('hiddenGroups', [])).toEqual(['a', 'b']);
    expect(second.get('studentID')).toBeNull();
  });

  test('a corrupt value reads as the fallback, never a crash', async () => {
    const kv = new MemoryKV();
    await kv.setItem('pref:skippedEvents', '{not json');
    const prefs = new Prefs(kv);
    await prefs.hydrate();
    expect(prefs.getJSON('skippedEvents', [])).toEqual([]);
  });

  test('the local report store keeps one row per person per class', async () => {
    const store = new LocalCancellationStore(newPrefs());
    const report = { eventKey: 'k', reporterID: 'me', stance: 'cancelled' as const, reportedAt: new Date() };
    await store.submit(report);
    await store.submit(report);
    expect(await store.tallies(['k'])).toEqual([{ eventKey: 'k', reportCount: 1, onCount: 0, myStance: 'cancelled' }]);
    await store.withdraw('k', 'me');
    expect(await store.tallies(['k'])).toEqual([]);
  });

  test('the local deadline store counts your own vouch', async () => {
    const store = new LocalDeadlineStore(newPrefs());
    const due = new Date(Date.now() + 86_400_000);
    const d = makeDeadline({ moduleKey: 'M', title: 'T', due, submitterID: 'me' });
    await store.submit(d);
    await store.confirm(d.id, 'me');
    await store.confirm(d.id, 'me');
    expect((await store.deadlinesForModules(['M'])).map((x) => x.id)).toEqual([d.id]);
    expect((await store.standings([d.id])).get(d.id)).toMatchObject({ confirmCount: 1, confirmedByMe: true });
    await store.withdraw(d.id, 'someone-else');
    expect(await store.deadlinesForModule('M')).toHaveLength(1);
    await store.withdraw(d.id, 'me');
    expect(await store.deadlinesForModule('M')).toHaveLength(0);
  });
});

describe('Widget snapshot', () => {
  const t = (day: number, hour: number) => at(2026, 9, day, hour);
  const ev = (id: string, start: Date, end: Date, locations = ['GLA.HG20']) =>
    event('CA106[1]OC/L1/01', start, end, { id, locations, moduleName: 'Computer Systems' });
  const clear = () => CancellationStatus.none;
  const deadline = (id: string, due: Date, kind: 'assignment' | 'quiz' = 'assignment') =>
    makeDeadline({ id, moduleKey: 'CA106', title: `Lab ${id}`, due, kind, submitterID: 'someone' });

  test('a class carries its times, title and room', () => {
    const snap = WidgetSnapshotPublisher.snapshot([ev('a', t(23, 9), t(23, 11))], [], clear, t(23, 8));
    expect(snap.classes[0]).toEqual({
      id: 'a', title: 'Computer Systems', code: 'CA106', room: 'HG20', start: '2026-09-23T08:00:00Z', end: '2026-09-23T10:00:00Z', state: 'scheduled',
    });
  });

  test('a class with no room carries an empty one', () => {
    expect(WidgetSnapshotPublisher.room(ev('a', t(23, 9), t(23, 11), []))).toBe('');
  });

  test('a flagged class is marked cancelled; reports below the bar are not', () => {
    const one = [ev('a', t(23, 9), t(23, 11))];
    expect(WidgetSnapshotPublisher.snapshot(one, [], () => new CancellationStatus(4), t(23, 8)).classes[0].state).toBe('cancelled');
    expect(WidgetSnapshotPublisher.snapshot(one, [], () => new CancellationStatus(2), t(23, 8)).classes[0].state).toBe('scheduled');
    expect(WidgetSnapshotPublisher.snapshot(one, [], () => new CancellationStatus(0, 0, null, { eventKey: 'k', state: 'moved' }), t(23, 8)).classes[0].state).toBe('moved');
  });

  test('classes are written in time order', () => {
    const snap = WidgetSnapshotPublisher.snapshot([ev('late', t(23, 15), t(23, 16)), ev('early', t(23, 9), t(23, 10))], [], clear, t(23, 8));
    expect(snap.classes.map((c) => c.id)).toEqual(['early', 'late']);
  });

  test('deadlines before today are not written', () => {
    const snap = WidgetSnapshotPublisher.snapshot([], [deadline('old', t(20, 12)), deadline('soon', t(25, 12))], clear, t(23, 8));
    expect(snap.deadlines.map((d) => d.id)).toEqual(['soon']);
  });

  test('a test sat in class is marked as one, with the SF Symbol the widget draws', () => {
    const snap = WidgetSnapshotPublisher.snapshot([], [deadline('quiz', t(25, 12), 'quiz')], clear, t(23, 8));
    expect(snap.deadlines[0].isSatInClass).toBe(true);
    expect(snap.deadlines[0].symbol).toBe(deadlineSFSymbol('quiz'));
    expect(snap.deadlines[0].symbol).toBe('checklist');
  });

  test('dates are whole-second ISO strings, which Swift decodes', () => {
    const snap = WidgetSnapshotPublisher.snapshot([], [], clear, new Date(Date.UTC(2026, 8, 23, 7, 0, 0, 456)));
    expect(snap.updatedAt).toBe('2026-09-23T07:00:00Z');
  });
});
