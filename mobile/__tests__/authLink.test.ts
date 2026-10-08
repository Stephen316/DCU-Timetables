import { parseAuthLink } from '../src/data/authLink';

const site = 'https://stephen316.github.io/DCU-Timetables/app/';
const now = Date.UTC(2026, 0, 1);

describe('Email links', () => {
  test('reads the session Supabase leaves in the fragment', () => {
    const link = parseAuthLink(`${site}#access_token=abc&refresh_token=def&expires_in=3600&token_type=bearer&type=signup`, now);
    expect(link).toEqual({
      kind: 'session',
      type: 'signup',
      tokens: { accessToken: 'abc', refreshToken: 'def', expiresAt: now + 3_600_000 },
    });
  });

  test('tells a reset link apart from a confirmation, because only one opens a screen', () => {
    const recovery = `${site}#access_token=abc&refresh_token=def&expires_in=3600&type=recovery`;
    expect(parseAuthLink(recovery, now)).toMatchObject({ kind: 'session', type: 'recovery' });
    // A magic link or an email change is still a session; it just has nothing extra to ask.
    expect(parseAuthLink(`${site}#access_token=abc&refresh_token=def&type=magiclink`, now)).toMatchObject({ type: 'other' });
  });

  test('prefers expires_at, which is absolute, over expires_in', () => {
    const at = Math.floor(now / 1000) + 7200;
    const link = parseAuthLink(`${site}#access_token=a&refresh_token=b&expires_at=${at}&expires_in=3600`, now);
    expect(link).toMatchObject({ tokens: { expiresAt: at * 1000 } });
  });

  test('says what to do about a link that has expired or been used', () => {
    const expired = parseAuthLink(`${site}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`, now);
    expect(expired).toEqual({ kind: 'failed', message: 'That link has expired. Ask for a new email and open the newest one.' });
    // Supabase's own wording is written for a developer, so none of it reaches the student.
    expect((expired as { message: string }).message).not.toMatch(/invalid or has expired/);
  });

  test('reads a failure off the query string too, which survives a redirect that drops the fragment', () => {
    expect(parseAuthLink(`${site}?error=server_error&error_description=whatever`, now)).toMatchObject({ kind: 'failed' });
  });

  test('ignores an ordinary visit, which is every launch but one', () => {
    expect(parseAuthLink(site, now)).toBeNull();
    expect(parseAuthLink(`${site}#/deadlines`, now)).toBeNull();
    // Half a session is no session: without both tokens there is nothing to store.
    expect(parseAuthLink(`${site}#access_token=abc&type=signup`, now)).toBeNull();
  });
});
