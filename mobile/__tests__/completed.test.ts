import { MemoryKV, Prefs, PrefKey } from '../src/data/storage';
import { CompletedDeadlines } from '../src/features/deadlines/Completed';

describe('Completed deadlines', () => {
  async function prefs() {
    const p = new Prefs(new MemoryKV());
    await p.hydrate();
    return p;
  }

  test('ticking one off and back again, kept across a reopen', async () => {
    const p = await prefs();
    const completed = new CompletedDeadlines(p);
    completed.toggle('a');
    expect(completed.has('a')).toBe(true);
    expect(new CompletedDeadlines(p).has('a')).toBe(true);
    completed.toggle('a');
    expect(completed.has('a')).toBe(false);
    expect(p.get(PrefKey.completedDeadlines)).toBeNull();
  });

  test('a garbled pref reads as nothing ticked', async () => {
    const p = await prefs();
    p.set(PrefKey.completedDeadlines, '{not json');
    expect(new CompletedDeadlines(p).has('a')).toBe(false);
  });
});
