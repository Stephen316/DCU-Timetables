import { makeDeadline } from '../src/core/deadline';
import { MemoryKV, PrefKey, Prefs } from '../src/data/storage';
import { LocalDeadlineStore, PrivateDeadlineStore } from '../src/data/stores';

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000);

async function stores(owner = { id: 'me' }) {
  const prefs = new Prefs(new MemoryKV());
  await prefs.hydrate();
  const shared = new LocalDeadlineStore(prefs);
  return { prefs, shared, store: new PrivateDeadlineStore(shared, prefs, () => owner.id), owner };
}

describe('Private deadlines', () => {
  test('a private one never reaches the shared store, and reads back beside the shared ones', async () => {
    const { prefs, shared, store } = await stores();
    await store.submit(makeDeadline({ moduleKey: 'CA116', title: 'Mine', due: inDays(2), submitterID: 'me', isPrivate: true }));
    await store.submit(makeDeadline({ moduleKey: 'CA116', title: 'Everyone', due: inDays(3), submitterID: 'me' }));
    expect((await shared.deadlinesForModule('CA116')).map((d) => d.title)).toEqual(['Everyone']);
    expect(prefs.getJSON(PrefKey.privateDeadlines, [] as unknown[])).toHaveLength(1);
    const all = await store.deadlinesForModules(['CA116']);
    expect(all.map((d) => [d.title, d.isPrivate ?? false])).toEqual([['Mine', true], ['Everyone', false]]);
  });

  test('changes to a private one stay private', async () => {
    const { shared, store } = await stores();
    const mine = makeDeadline({ moduleKey: 'CA116', title: 'Mine', due: inDays(2), submitterID: 'me', isPrivate: true });
    await store.submit(mine);
    await store.setDetails(mine.id, 'Room 2');
    await store.edit(mine.id, { title: 'Mine, renamed', kind: 'quiz', due: mine.due, gradeWeight: 5 });
    await store.confirm(mine.id, 'me');
    expect(await shared.deadlinesForModule('CA116')).toEqual([]);
    const [read] = await store.deadlinesForModule('CA116');
    expect(read).toMatchObject({ title: 'Mine, renamed', details: 'Room 2', kind: 'quiz', isPrivate: true });
    expect((await store.standings([mine.id])).get(mine.id)?.confirmedByMe).toBe(true);
    await store.withdraw(mine.id, 'me');
    expect(await store.deadlinesForModule('CA116')).toEqual([]);
  });

  test('another account signed in on the same device does not see them', async () => {
    const { store, owner } = await stores();
    await store.submit(makeDeadline({ moduleKey: 'CA116', title: 'Mine', due: inDays(2), submitterID: 'me', isPrivate: true }));
    owner.id = 'someone else';
    expect(await store.deadlinesForModule('CA116')).toEqual([]);
  });
});
