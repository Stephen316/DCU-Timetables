import { parseDCUEmail } from '../src/core/identity';
import { makeDeadline } from '../src/core/deadline';
import { SupabaseAuthService } from '../src/data/auth';
import { SupabaseAllocationStore, SupabaseLabRotationStore, SupabaseTimetableChangeStore } from '../src/data/courseData';
import { DCUAPIClient } from '../src/data/dcuApi';
import { SupabaseREST } from '../src/data/rest';
import { SupabaseSession } from '../src/data/session';
import {
  SupabaseCancellationStore, SupabaseDeadlineStore, SupabaseProfileStore, SupabaseVerdictStore,
} from '../src/data/stores';
import { utc } from './helpers';

/**
 * What goes over the wire. These pin each request to the one the iOS app made, since the
 * database's row-level security and the console read exactly these shapes.
 */
interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function fakeFetch(respond: (call: Call) => { status?: number; body?: unknown } = () => ({ body: [] })) {
  const calls: Call[] = [];
  const fn = jest.fn(async (url: string, init: RequestInit = {}) => {
    const call: Call = {
      url,
      method: init.method ?? 'GET',
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const { status = 200, body } = respond(call);
    return new Response(body === undefined ? '' : JSON.stringify(body), { status });
  });
  return { calls, fn: fn as unknown as typeof fetch };
}

const config = { url: 'https://proj.supabase.co', anonKey: 'anon-key' };
const memorySecrets = () => {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: string) => void m.set(k, v), remove: async (k: string) => void m.delete(k) };
};

async function signedInREST(fetchFn: typeof fetch) {
  const session = new SupabaseSession(memorySecrets(), () => undefined, fetchFn);
  await session.save({ accessToken: 'user-token', refreshToken: 'r', userID: 'user-1', expiresAt: Date.now() + 3_600_000 });
  return new SupabaseREST(config, session, fetchFn);
}

async function anonREST(fetchFn: typeof fetch) {
  return new SupabaseREST(config, new SupabaseSession(memorySecrets(), () => undefined, fetchFn), fetchFn);
}

const query = (url: string) => Object.fromEntries(new URL(url).searchParams);

describe('Supabase requests', () => {
  test('tallies are read from the view, filtered to the keys, as the student', async () => {
    const { calls, fn } = fakeFetch(() => ({ body: [{ event_key: 'k', report_count: 3, on_count: null, my_stance: 'cancelled' }] }));
    const tallies = await new SupabaseCancellationStore(await signedInREST(fn)).tallies(['k', 'a,b']);
    expect(calls[0].url.startsWith('https://proj.supabase.co/rest/v1/cancellation_tallies?')).toBe(true);
    expect(query(calls[0].url)).toEqual({ select: 'event_key,report_count,on_count,my_stance', event_key: 'in.("k","a,b")' });
    expect(calls[0].headers).toMatchObject({ apikey: 'anon-key', Authorization: 'Bearer user-token' });
    expect(tallies).toEqual([{ eventKey: 'k', reportCount: 3, onCount: 0, myStance: 'cancelled' }]);
  });

  test('without a session a read goes out on the anon key', async () => {
    const { calls, fn } = fakeFetch();
    await new SupabaseCancellationStore(await anonREST(fn)).tallies(['k']);
    expect(calls[0].headers.Authorization).toBe('Bearer anon-key');
  });

  test('a report is an insert that ignores duplicates; a withdrawal deletes by key and reporter', async () => {
    const { calls, fn } = fakeFetch(() => ({ status: 201 }));
    const store = new SupabaseCancellationStore(await signedInREST(fn));
    await store.submit({ eventKey: 'k', reporterID: 'user-1', stance: 'on', reportedAt: new Date() });
    await store.withdraw('k', 'user-1');
    expect(calls[0]).toMatchObject({ method: 'POST', body: [{ event_key: 'k', reporter_id: 'user-1', stance: 'on' }] });
    expect(calls[0].headers.Prefer).toBe('resolution=ignore-duplicates');
    expect(calls[1].method).toBe('DELETE');
    expect(query(calls[1].url)).toEqual({ event_key: 'eq.k', reporter_id: 'eq.user-1' });
  });

  test('a refused report says so in words', async () => {
    const { fn } = fakeFetch(() => ({ status: 403 }));
    await expect(new SupabaseCancellationStore(await signedInREST(fn)).submit({ eventKey: 'k', reporterID: 'u', stance: 'cancelled', reportedAt: new Date() }))
      .rejects.toThrow('Report service returned 403.');
  });

  test('deadlines come from the public view, floored at today, soonest first', async () => {
    const { calls, fn } = fakeFetch(() => ({ body: [{
      id: 'd1', module_key: 'CA106', at_group_key: null, title: 'Quiz', due_at: '2026-09-25T09:00:00+00:00', kind: 'quiz',
      is_mine: true, submitted_at: '2026-09-20T09:00:00.123456+00:00',
    }] }));
    const list = await new SupabaseDeadlineStore(await signedInREST(fn)).deadlinesForModules(['MS121', 'CA106', 'CA106']);
    const q = query(calls[0].url);
    expect(calls[0].url).toContain('/rest/v1/module_deadlines_public?');
    expect(q.module_key).toBe('in.("CA106","MS121")');
    expect(q.due_at).toMatch(/^gte\.\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(q.order).toBe('due_at.asc');
    expect(list[0]).toMatchObject({ id: 'd1', kind: 'quiz', isMine: true, submitterID: '', due: utc(2026, 9, 25, 9) });
  });

  test('a deadline is written to the table with its submitter', async () => {
    const { calls, fn } = fakeFetch(() => ({ status: 201 }));
    const d = makeDeadline({ id: 'd1', moduleKey: 'CA106', atGroupKey: 'g', title: 'Quiz', due: utc(2026, 9, 25, 9), kind: 'quiz', submitterID: 'user-1' });
    await new SupabaseDeadlineStore(await signedInREST(fn)).submit(d);
    expect(calls[0].url).toBe('https://proj.supabase.co/rest/v1/module_deadlines');
    expect(calls[0].body).toEqual([{ id: 'd1', module_key: 'CA106', at_group_key: 'g', title: 'Quiz', due_at: '2026-09-25T09:00:00Z', kind: 'quiz', submitter_id: 'user-1' }]);
  });

  test('moderation goes through the RPCs by deadline, never by person', async () => {
    const { calls, fn } = fakeFetch((c) => ({ body: c.url.endsWith('hidden_author_count') ? 2 : null }));
    const store = new SupabaseDeadlineStore(await signedInREST(fn));
    await store.report('d1', 'spam');
    await store.hideAuthor('d1');
    expect(await store.hiddenAuthorCount()).toBe(2);
    await store.unhideAllAuthors();
    expect(calls.map((c) => [c.url.replace(config.url, ''), c.body])).toEqual([
      ['/rest/v1/rpc/report_deadline', { p_deadline: 'd1', p_reason: 'spam' }],
      ['/rest/v1/rpc/hide_author_of', { p_deadline: 'd1' }],
      ['/rest/v1/rpc/hidden_author_count', {}],
      ['/rest/v1/rpc/unhide_all_authors', {}],
    ]);
  });

  test('standings come from the tally view', async () => {
    const { calls, fn } = fakeFetch(() => ({ body: [{ deadline_id: 'd1', confirm_count: 4, mine: true }] }));
    const s = await new SupabaseDeadlineStore(await signedInREST(fn)).standings(['d1']);
    expect(query(calls[0].url)).toEqual({ select: 'deadline_id,confirm_count,mine', deadline_id: 'in.("d1")' });
    expect(s.get('d1')).toMatchObject({ confirmCount: 4, confirmedByMe: true });
  });

  test('a verdict replaces the row, and unknown states are dropped on read', async () => {
    const { calls, fn } = fakeFetch((c) => ({ body: c.method === 'GET' ? [
      { event_key: 'k', state: 'cancelled', note: null, decided_by_label: 'the class rep', decided_at: '2026-09-20T09:00:00+00:00' },
      { event_key: 'k2', state: 'rescheduled' },
    ] : null }));
    const store = new SupabaseVerdictStore(await signedInREST(fn));
    await store.set({ eventKey: 'k', state: 'moved', roomOverride: 'Q119' }, 'CA106', 'user-1');
    expect(calls[0].headers.Prefer).toBe('resolution=merge-duplicates');
    expect(calls[0].body).toEqual([{ event_key: 'k', state: 'moved', decided_by: 'user-1', module_key: 'CA106', room_override: 'Q119' }]);
    const read = await store.verdicts(['k', 'k2']);
    expect(read.map((v) => v.state)).toEqual(['cancelled']);
  });

  test("a student's verdict is refused in words", async () => {
    const { fn } = fakeFetch(() => ({ status: 403 }));
    await expect(new SupabaseVerdictStore(await signedInREST(fn)).set({ eventKey: 'k', state: 'cancelled' }, 'M', 'u'))
      .rejects.toThrow("You don't have permission to decide this.");
  });

  test("the profile is the signed-in account's row", async () => {
    const { calls, fn } = fakeFetch(() => ({ body: [{ id: 'user-1', role: 'trusted', pi: 'K482913', display_name: null, banned_until: null, student_id: 'A12345678' }] }));
    const profile = await new SupabaseProfileStore(await signedInREST(fn)).myProfile();
    expect(query(calls[0].url)).toEqual({ select: 'id,role,pi,display_name,banned_until,student_id', id: 'eq.user-1' });
    expect(profile).toMatchObject({ role: 'trusted', pi: 'K482913', studentID: 'A12345678' });
  });

  test("the database's refusal of a second student number reaches the student", async () => {
    const { calls, fn } = fakeFetch(() => ({ status: 400, body: { message: 'your student ID is already set — ask an admin to change it' } }));
    await expect(new SupabaseProfileStore(await signedInREST(fn)).setStudentID('A12345678'))
      .rejects.toThrow('Your student ID is already set — ask an admin to change it');
    expect(calls[0]).toMatchObject({ url: 'https://proj.supabase.co/rest/v1/rpc/set_student_id', body: { p_student_id: 'A12345678' } });
  });

  test('allocation lookups use the bytea literal and the RPC', async () => {
    const { calls, fn } = fakeFetch((c) => ({
      body: c.url.includes('rpc') ? [{ status: 'matched', allocation_key: 'ab12', version: 2 }] : [{ grp: 'B', subgroup: 'B.1', day: null, workshop: 'SG23', drawing: null }],
    }));
    const store = new SupabaseAllocationStore(await signedInREST(fn));
    expect(await store.resolve('EEG1', null)).toEqual({ kind: 'matched', key: 'ab12', version: 2 });
    expect(calls[0].body).toEqual({ p_course_key: 'EEG1' });
    expect(await store.allocation('EEG1', 'ab12')).toMatchObject({ group: 'B', workshop: 'SG23' });
    expect(query(calls[1].url).allocation_key).toBe('eq.\\xab12');
  });

  test('rotation and changes are read signed in or not at all', async () => {
    const { calls, fn } = fakeFetch();
    const anon = await anonREST(fn);
    await expect(new SupabaseLabRotationStore(anon).version('EEG1')).rejects.toThrow('401');
    await expect(new SupabaseTimetableChangeStore(anon).changes('EEG1')).rejects.toThrow('401');
    expect(calls).toHaveLength(0);
  });
});

describe('Auth requests', () => {
  const email = parseDCUEmail('aoife.murphy5@mail.dcu.ie')!;

  test('sign-in saves the session and returns the user', async () => {
    const { calls, fn } = fakeFetch(() => ({ body: { access_token: 'a', refresh_token: 'r', expires_in: 3600, user: { id: 'u1' } } }));
    const session = new SupabaseSession(memorySecrets(), () => undefined, fn);
    const user = await new SupabaseAuthService(config, session, fn).signIn(email, 'Password1');
    expect(calls[0]).toMatchObject({ url: 'https://proj.supabase.co/auth/v1/token?grant_type=password', body: { email: 'aoife.murphy5@mail.dcu.ie', password: 'Password1' } });
    expect(user).toEqual({ id: 'u1', address: 'aoife.murphy5@mail.dcu.ie' });
    expect(session.userID).toBe('u1');
  });

  test('an unconfirmed address is told apart from a wrong password', async () => {
    const { fn } = fakeFetch(() => ({ status: 400, body: { error_code: 'email_not_confirmed', msg: 'Email not confirmed' } }));
    const service = new SupabaseAuthService(config, new SupabaseSession(memorySecrets(), () => undefined, fn), fn);
    await expect(service.signIn(email, 'x')).rejects.toMatchObject({ kind: 'emailNotConfirmed' });
  });

  test("the server's own words are shown, and 429 is explained", async () => {
    let status = 400;
    const { fn } = fakeFetch(() => ({ status, body: status === 400 ? { error_description: 'Invalid login credentials' } : {} }));
    const service = new SupabaseAuthService(config, new SupabaseSession(memorySecrets(), () => undefined, fn), fn);
    await expect(service.signIn(email, 'x')).rejects.toThrow('Invalid login credentials');
    status = 429;
    await expect(service.signIn(email, 'x')).rejects.toThrow('Too many attempts — wait a minute and try again.');
  });

  test('sign-up without a session needs the email confirmed', async () => {
    const { fn } = fakeFetch(() => ({ body: { id: 'u1', email: 'x' } }));
    const service = new SupabaseAuthService(config, new SupabaseSession(memorySecrets(), () => undefined, fn), fn);
    expect(await service.signUp(email, 'Password1')).toEqual({ kind: 'needsEmailConfirmation' });
  });
});

describe('DCU API requests', () => {
  const viewOptions = {
    Weeks: [
      { WeekNumber: 2, WeekLabel: '2', FirstDayInWeek: '2026-09-14T00:00:00+00:00' },
      { WeekNumber: 3, WeekLabel: '3', FirstDayInWeek: '2026-09-21T00:00:00+00:00' },
    ],
    Days: [{ Name: 'Monday', DayOfWeek: 1, IsDefault: true }, { Name: 'Tuesday', DayOfWeek: 2 }],
  };

  test('the week calendar comes from ViewOptions', async () => {
    const { calls, fn } = fakeFetch(() => ({ body: viewOptions }));
    const cal = await new DCUAPIClient(undefined, fn).weekCalendar();
    expect(calls[0].url).toBe('https://scientia-eu-v4-api-d1-03.azurewebsites.net/api/Public/ViewOptions/a1fdee6b-68eb-47b8-b2ac-a4c60c8e6177');
    expect(calls[0].headers).toMatchObject({ Authorization: 'Anonymous', Accept: 'application/json' });
    expect(cal.weeks.map((w) => w.number)).toEqual([2, 3]);
    expect(cal.weeks[1].firstDay).toEqual(utc(2026, 9, 21));
  });

  test('search puts the term in the query string and posts an empty list', async () => {
    const { calls, fn } = fakeFetch(() => ({ body: { Results: [{ Identity: 'id1', Name: 'CASE1 (Computer Science)', CategoryTypeIdentity: null }] } }));
    const found = await new DCUAPIClient(undefined, fn).searchProgrammes('CASE');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].body).toEqual([]);
    expect(query(calls[0].url)).toEqual({ query: 'CASE', itemsPerPage: '50', pageNumber: '1', returnOccurrences: 'false' });
    expect(calls[0].url).toContain('/Public/CategoryTypes/241e4d36-60e0-49f8-b27e-99416745d98d/Categories/FilterWithCache/');
    expect(found).toEqual([{ identity: 'id1', name: 'CASE1 (Computer Science)', categoryTypeIdentity: '241e4d36-60e0-49f8-b27e-99416745d98d' }]);
  });

  test('an events request carries the complete view options', async () => {
    const { calls, fn } = fakeFetch((c) => ({ body: c.url.includes('ViewOptions') ? viewOptions : { CategoryEvents: [] } }));
    const client = new DCUAPIClient(undefined, fn);
    await client.events({ identity: 'cat', name: 'CASE1', categoryTypeIdentity: 'type' }, [{ number: 3, label: '3', firstDay: utc(2026, 9, 21) }]);
    expect(calls[1].body).toEqual({
      ViewOptions: {
        Days: [{ Name: 'Monday', DayOfWeek: 1, IsDefault: true }, { Name: 'Tuesday', DayOfWeek: 2 }],
        Weeks: [{ WeekNumber: 3, WeekLabel: '3', FirstDayInWeek: '2026-09-21T00:00:00+00:00' }],
        TimePeriods: [{ Description: 'All Day', StartTime: '00:00', EndTime: '23:59', IsDefault: true }],
        DatePeriods: [{ Description: 'Range', StartDateTime: '2026-09-21T00:00:00+00:00', EndDateTime: '2026-09-28T00:00:00Z', IsDefault: true }],
      },
      CategoryTypesWithIdentities: [{ CategoryTypeIdentity: 'type', CategoryIdentities: ['cat'] }],
      FetchBookings: false,
      FetchPersonalEvents: false,
      PersonalIdentities: [],
    });
  });

  test('an error status becomes a readable error', async () => {
    const { fn } = fakeFetch(() => ({ status: 503 }));
    await expect(new DCUAPIClient(undefined, fn).weekCalendar()).rejects.toThrow('The timetable service returned an error (503).');
  });
});
