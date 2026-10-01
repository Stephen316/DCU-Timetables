import { HANDOVER_PREFS, Handovers, WEB_SESSION_KEY } from '../src/data/handover';
import { MemoryKV, PrefKey, Prefs } from '../src/data/storage';
import { createServices } from '../src/data/services';

const session = JSON.stringify({ accessToken: 'a'.repeat(900), refreshToken: 'r1', expiresAt: 1, userID: 'u1' });
const user = JSON.stringify({ id: 'u1', address: 'aoife.murphy5@mail.dcu.ie' });

async function signedInPrefs(): Promise<Prefs> {
  const prefs = new Prefs(new MemoryKV());
  prefs.set(PrefKey.signedInUser, user);
  prefs.set(PrefKey.studentID, 'A00000000');
  prefs.set(PrefKey.appearance, 'dark');
  return prefs;
}

describe('Handing a web sign-in over to the Home Screen app', () => {
  test('carries the refresh token and who is signed in, and nothing else', async () => {
    const handover = Handovers.from(session, await signedInPrefs());
    expect(handover).toEqual({
      refreshToken: 'r1', userID: 'u1', prefs: { [PrefKey.signedInUser]: user, [PrefKey.studentID]: 'A00000000' },
    });
    const value = Handovers.encode(handover!);
    expect(value).not.toContain('aaaa');
    expect(Handovers.decode(value)).toEqual(handover);
  });

  test('nobody signed in hands over nothing', async () => {
    expect(Handovers.from(null, await signedInPrefs())).toBeNull();
    expect(Handovers.from('{"userID":"u1"}', await signedInPrefs())).toBeNull();
  });

  test('a cookie that is damaged, or names prefs it has no business with, is read defensively', () => {
    expect(Handovers.decode('%E0%A4%A')).toBeNull();
    expect(Handovers.decode(encodeURIComponent('{"r":"r1"}'))).toBeNull();
    const sneaky = encodeURIComponent(JSON.stringify({ r: 'r1', u: 'u1', p: { [PrefKey.role]: 'admin', [PrefKey.studentID]: 'A1' } }));
    expect(Handovers.decode(sneaky)?.prefs).toEqual({ [PrefKey.studentID]: 'A1' });
  });

  test("the Home Screen app's empty storage starts signed in, with a session that refreshes first", async () => {
    const kv = new MemoryKV();
    const handover = Handovers.from(session, await signedInPrefs());
    expect(await Handovers.restore(kv, handover)).toBe(true);

    const services = await createServices({
      kv, env: {},
      secrets: { get: (k) => kv.getItem(`secret:${k}`), set: (k, v) => kv.setItem(`secret:${k}`, v), remove: (k) => kv.removeItem(`secret:${k}`) },
    });
    expect(services.user.current?.id).toBe('u1');
    expect(services.prefs.get(PrefKey.studentID)).toBe('A00000000');
    expect(services.session.userID).toBe('u1');
    expect(JSON.parse((await kv.getItem(WEB_SESSION_KEY))!).expiresAt).toBe(0);
  });

  test('storage with its own sign-in is left alone', async () => {
    const kv = new MemoryKV();
    await kv.setItem(WEB_SESSION_KEY, 'mine');
    expect(await Handovers.restore(kv, Handovers.from(session, await signedInPrefs()))).toBe(false);
    expect(await kv.getItem(WEB_SESSION_KEY)).toBe('mine');
    expect(await kv.getItem(`pref:${PrefKey.signedInUser}`)).toBeNull();
  });

  test('every pref handed over fits a cookie with a real profile in it', () => {
    const prefs = new Prefs(new MemoryKV());
    prefs.set(PrefKey.signedInUser, user);
    prefs.set(PrefKey.studentID, 'A00000000');
    prefs.set(PrefKey.profile, JSON.stringify({ name: 'Aoife Murphy', cohort: 'engineeringYear1', group: 'D', subgroup: 'D.1', workshop: 'SG23', drawing: 'SB39', courseKey: 'EEG1', allocationKey: 'x'.repeat(64), rosterVersion: 3 }));
    prefs.set(PrefKey.selectedProgramme, JSON.stringify({ identity: 'f'.repeat(36), name: 'ECE1 (Electronic and Computer Engineering-1)', categoryTypeIdentity: 'e'.repeat(36) }));
    expect(HANDOVER_PREFS.every((k) => prefs.get(k) !== null)).toBe(true);
    expect(Handovers.encode(Handovers.from(session, prefs)!)).not.toBeNull();
  });
});
