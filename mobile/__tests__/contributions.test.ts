import { Contribution, Contributions } from '../src/core/contributions';

const names = new Map([['EEG1006', 'Materials Engineering'], ['EEG1000', 'Professional Development']]);
const moduleName = (key: string) => names.get(key) ?? key;

const report = (count: number, at = '2026-10-28T09:00:00Z'): Contribution => ({
  kind: 'report', ref: 'EEG1006[1]OC/P1/02|2026-10-28T10:00:00Z', moduleKey: null, title: null, count, happenedAt: new Date(at),
});
const deadline = (count: number, at = '2026-10-27T09:00:00Z'): Contribution => ({
  kind: 'deadline', ref: 'd-1', moduleKey: 'EEG1000', title: 'Reflective essay', count, happenedAt: new Date(at),
});

describe('Contributions', () => {
  test('rows decode, and one that does not read as a contribution is skipped', () => {
    const decoded = Contributions.decode([
      { kind: 'report', ref: 'K|2026-10-28T10:00:00Z', module_key: null, title: null, count: 4, happened_at: '2026-10-28T09:00:00Z' },
      // PostgREST sends a bigint as a number, but a string still counts.
      { kind: 'deadline', ref: 'd-1', module_key: 'EEG1000', title: 'Essay', count: '2', happened_at: '2026-10-27T09:00:00Z' },
      { kind: 'vote', ref: 'x', count: 1, happened_at: '2026-10-27T09:00:00Z' },
      { kind: 'report', ref: 'y', count: 1, happened_at: 'not a date' },
    ]);
    expect(decoded.map((c) => [c.kind, c.count])).toEqual([['report', 4], ['deadline', 2]]);
  });

  test('the newest untold one is next, and a told one is never told again', () => {
    const all = [deadline(2), report(4)];
    expect(Contributions.next(all, [])?.kind).toBe('report');
    expect(Contributions.next(all, [Contributions.toldKey(report(4))])?.kind).toBe('deadline');
    expect(Contributions.next(all, all.map(Contributions.toldKey))).toBeNull();
  });

  test('told keys the server no longer returns are dropped', () => {
    expect(Contributions.prune(['report:gone', Contributions.toldKey(deadline(2))], [deadline(2)])).toEqual(['deadline:d-1']);
  });

  test('a report names the class from its key, even one the phone has not loaded', () => {
    expect(Contributions.className(report(4).ref, moduleName)).toBe('Materials Engineering lab');
    expect(Contributions.className('|2026-10-28T10:00:00Z', moduleName)).toBe('your class');
    expect(Contributions.message(report(4), moduleName).body)
      .toBe('You and 3 others reported Materials Engineering lab cancelled, so your classmates knew not to go.');
    expect(Contributions.message(report(2), moduleName).body).toMatch(/^You and 1 other reported/);
    // Only the caller's own report, so an organiser is what called it off.
    expect(Contributions.message(report(1), moduleName).body).toMatch(/an organiser confirmed it/);
  });

  test('a deadline counts the classmates who confirmed it, or says a moderator did', () => {
    expect(Contributions.message(deadline(3), moduleName))
      .toEqual({ title: 'Your deadline helped', body: '3 classmates confirmed “Reflective essay” for Professional Development, which you added.' });
    expect(Contributions.message(deadline(1), moduleName).body).toMatch(/^1 classmate confirmed/);
    expect(Contributions.message(deadline(0), moduleName).body).toMatch(/^A moderator confirmed/);
  });
});
