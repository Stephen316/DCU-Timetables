import { AsyncKV, PrefKey, Prefs } from './storage';

/**
 * What carries a web sign-in onto the Home Screen. Adding the web app to the Home Screen on
 * iOS 17.2+ gives it its own storage, empty but for a copy of the site's cookies — the
 * localStorage the session lives in stays behind in Safari, and the app opens signed out. So
 * the web build keeps this in a cookie as well: enough to come back signed in, and no more.
 *
 * Only the refresh token, not the access token: it is the smaller of the two, and the first
 * request trades it for a fresh session anyway.
 */
export interface Handover {
  refreshToken: string;
  userID: string;
  /** The prefs that say who is signed in and whose timetable to show, as stored. */
  prefs: Record<string, string>;
}

/** Without these the app would have the session but still ask who the student is. */
export const HANDOVER_PREFS: readonly string[] = [PrefKey.signedInUser, PrefKey.studentID, PrefKey.profile, PrefKey.selectedProgramme];

/** Where `webSecrets` keeps the session, and where a restored one has to go. */
export const WEB_SESSION_KEY = 'secret:session';

/** A cookie holds about 4 KB; one this size is left unwritten rather than cut short. */
const MAX_COOKIE_VALUE = 3800;

export const Handovers = {
  /** From the stored session and the prefs. Null when nobody is signed in. */
  from(sessionJSON: string | null, prefs: Prefs): Handover | null {
    const session = parse(sessionJSON);
    if (typeof session?.refreshToken !== 'string' || typeof session.userID !== 'string') return null;
    const saved: Record<string, string> = {};
    for (const key of HANDOVER_PREFS) {
      const value = prefs.get(key);
      if (value !== null) saved[key] = value;
    }
    return { refreshToken: session.refreshToken, userID: session.userID, prefs: saved };
  },

  /** The cookie's value, or null when it wouldn't fit in one. */
  encode(handover: Handover): string | null {
    const value = encodeURIComponent(JSON.stringify({ r: handover.refreshToken, u: handover.userID, p: handover.prefs }));
    return value.length <= MAX_COOKIE_VALUE ? value : null;
  },

  decode(value: string | null): Handover | null {
    if (!value) return null;
    let json: Record<string, unknown> | null;
    try {
      json = parse(decodeURIComponent(value));
    } catch {
      return null;
    }
    if (typeof json?.r !== 'string' || typeof json.u !== 'string' || typeof json.p !== 'object' || json.p === null) return null;
    const prefs: Record<string, string> = {};
    for (const [key, v] of Object.entries(json.p as Record<string, unknown>)) {
      if (HANDOVER_PREFS.includes(key) && typeof v === 'string') prefs[key] = v;
    }
    return { refreshToken: json.r, userID: json.u, prefs };
  },

  /**
   * Puts a handed-over sign-in into storage that has none of its own — the Home Screen app's
   * first launch. Storage with a session already is left alone: it is its own sign-in, and
   * may be a different student's. The session is stored as already expired, so the first
   * request refreshes it. Runs before the app reads its storage.
   */
  async restore(kv: AsyncKV, handover: Handover | null): Promise<boolean> {
    if (!handover || (await kv.getItem(WEB_SESSION_KEY)) !== null) return false;
    const session = { accessToken: '', refreshToken: handover.refreshToken, expiresAt: 0, userID: handover.userID };
    await kv.setItem(WEB_SESSION_KEY, JSON.stringify(session));
    for (const [key, value] of Object.entries(handover.prefs)) {
      if ((await kv.getItem(`pref:${key}`)) === null) await kv.setItem(`pref:${key}`, value);
    }
    return true;
  },
};

function parse(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const value: unknown = JSON.parse(json);
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
