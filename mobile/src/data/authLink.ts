import { Platform } from 'react-native';
import { AuthSession } from './session';

/**
 * Supabase verifies an emailed link on its own servers and then sends the browser on to
 * the project's Site URL — the public site — carrying the result in the URL *fragment*:
 * `#access_token=…&refresh_token=…&expires_at=…&type=signup`, or `#error=access_denied&
 * error_code=otp_expired` when the link has already been used or has aged out. The site's
 * index page forwards that fragment to the app, which is what this reads.
 *
 * A fragment is never sent to a server, so none of this can be done anywhere but here.
 */
export type AuthLink =
  /** The link worked. `type` says which email it came from. */
  | { kind: 'session'; type: AuthLinkType; tokens: EmailLinkTokens }
  /** The link didn't work, in words for the student. */
  | { kind: 'failed'; message: string };

export type AuthLinkType = 'signup' | 'recovery' | 'other';

/** What the fragment carries. The user id and address are not in it — they're fetched. */
export interface EmailLinkTokens {
  accessToken: string;
  refreshToken: string;
  /** Milliseconds since 1970, matching {@link AuthSession}. */
  expiresAt: number;
}

/**
 * Reads the result of an email link out of a URL. Null for an ordinary visit, which is
 * every launch but the one that followed a link.
 */
export function parseAuthLink(url: string, now: number = Date.now()): AuthLink | null {
  const params = authParams(url);
  if (!params) return null;

  const error = params.get('error') ?? params.get('error_code');
  if (error) return { kind: 'failed', message: failureMessage(params) };

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) return null;

  return {
    kind: 'session',
    type: linkType(params.get('type')),
    tokens: { accessToken, refreshToken, expiresAt: expiryMillis(params, now) },
  };
}

/** Null until the URL has been read; `{ link }` after, so the answer survives a re-render. */
let taken: { link: AuthLink | null } | null = null;

/**
 * The URL the app was opened with, with the tokens wiped from the address bar as they are
 * read so a reload — or a shared link, or the browser's history — can't replay them.
 *
 * Reads the address once per page load and answers the same thing every call after, since
 * a second read would find the URL already cleared and report an ordinary visit.
 *
 * Web only: the Site URL sends every email link to the website, so a phone with the app
 * installed confirms in its browser and comes back to the app to sign in.
 */
export function takeAuthLink(now: number = Date.now()): AuthLink | null {
  if (taken) return taken.link;
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const link = parseAuthLink(window.location.href, now);
  if (link) window.history.replaceState(null, '', window.location.pathname + window.location.search);
  taken = { link };
  return link;
}

function authParams(url: string): URLSearchParams | null {
  const hash = url.slice(url.indexOf('#') + 1);
  const fragment = url.includes('#') && hash ? new URLSearchParams(hash) : null;
  if (fragment && (fragment.has('access_token') || fragment.has('error') || fragment.has('error_code'))) return fragment;
  // An error can also come back on the query string, which survives a redirect that drops
  // the fragment.
  const start = url.indexOf('?');
  if (start === -1) return null;
  const end = url.indexOf('#');
  const query = new URLSearchParams(url.slice(start + 1, end === -1 ? undefined : end));
  return query.has('error') || query.has('error_code') ? query : null;
}

function linkType(raw: string | null): AuthLinkType {
  return raw === 'signup' || raw === 'recovery' ? raw : 'other';
}

/** `expires_at` is a unix timestamp, `expires_in` is seconds from now. Either may be sent. */
function expiryMillis(params: URLSearchParams, now: number): number {
  const at = Number(params.get('expires_at'));
  if (Number.isFinite(at) && at > 0) return at * 1000;
  const seconds = Number(params.get('expires_in'));
  return now + (Number.isFinite(seconds) && seconds > 0 ? seconds : 3600) * 1000;
}

/**
 * Supabase's own `error_description` is written for a developer ("Email link is invalid or
 * has expired"), and the two cases a student actually hits have different answers, so each
 * gets its own line.
 */
function failureMessage(params: URLSearchParams): string {
  switch (params.get('error_code')) {
    case 'otp_expired':
      return 'That link has expired. Ask for a new email and open the newest one.';
    case 'access_denied':
      return 'That link has already been used. Sign in, or ask for a new email.';
    default:
      return "That link didn't work. Ask for a new email and open the newest one.";
  }
}

/** The stored session, once the account behind the tokens is known. */
export function sessionFromLink(tokens: EmailLinkTokens, userID: string): AuthSession {
  return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt, userID };
}
