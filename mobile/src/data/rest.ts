import { SupabaseConfig, SupabaseSession } from './session';

/** A request the server answered with a non-2xx status. `message` is written for a student. */
export class ServiceError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'ServiceError';
  }
}

/** The message to show for anything thrown, with a fallback for errors that carry none worth showing. */
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ServiceError) return error.message;
  if (error instanceof Error && error.name === 'UserFacingError') return error.message;
  return fallback;
}

/** An error whose message is meant for the student as it stands. */
export function userFacing(message: string): Error {
  const error = new Error(message);
  error.name = 'UserFacingError';
  return error;
}

/**
 * The app remembers who signed in, but the tokens that let it act for them are gone. Told
 * apart from other refusals so a screen can send the student back to sign-in rather than
 * show a message that no button on it can fix.
 */
export function notSignedIn(): Error {
  return Object.assign(userFacing("You're not signed in."), { code: 'notSignedIn' });
}

export function isNotSignedIn(error: unknown): boolean {
  return error instanceof Error && (error as Error & { code?: unknown }).code === 'notSignedIn';
}

export type Query = [string, string][];

/**
 * Percent-encodes every value, spaces included, so an activity code like
 * "BIO1000[1]OC/L1/01 Surname A - M" reaches PostgREST intact.
 */
export function buildQuery(query: Query): string {
  return query.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

/** Small shared pieces of PostgREST's query syntax, so every caller quotes the same way. */
export const PostgREST = {
  /**
   * `in.("a","b")`, with embedded quotes stripped rather than escaped: none of the keys this
   * app filters on can legitimately contain one. Unquoted, a value with a comma would
   * silently become two filters.
   */
  inList(values: string[]): string {
    return `in.(${values.map((v) => `"${v.replace(/"/g, '')}"`).join(',')})`;
  },
};

type Auth =
  /** As the signed-in student when there is a session, else the anon key (read-only by RLS). */
  | 'userOrAnon'
  /**
   * Signed in or not at all. Some tables are readable only by signed-in users, so the anon
   * key would get an empty answer — which reads as "nothing saved" and would throw away a
   * good cached copy.
   */
  | 'userOnly';

/** PostgREST and RPC calls against the project, authorised the way each table needs. */
export class SupabaseREST {
  constructor(
    readonly config: SupabaseConfig,
    readonly session: SupabaseSession,
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
  ) {}

  async request(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    options: { query?: Query; body?: unknown; prefer?: string; auth?: Auth } = {},
  ): Promise<Response> {
    const token = await this.session.accessToken(this.config);
    if (!token && options.auth === 'userOnly') throw new ServiceError(401, 'The server returned 401.');
    const headers: Record<string, string> = {
      apikey: this.config.anonKey,
      Authorization: `Bearer ${token ?? this.config.anonKey}`,
    };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.prefer) headers.Prefer = options.prefer;
    const query = options.query && options.query.length > 0 ? `?${buildQuery(options.query)}` : '';
    return this.fetchFn(`${this.config.url}${path}${query}`, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  }

  /** The response body as JSON, or throws `describe(status)` for a non-2xx answer. */
  async json(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    describe: (status: number) => string,
    options: { query?: Query; body?: unknown; prefer?: string; auth?: Auth } = {},
  ): Promise<unknown> {
    const response = await this.request(method, path, options);
    if (!response.ok) throw new ServiceError(response.status, describe(response.status));
    const text = await response.text();
    if (text.length === 0) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
}

/** A PostgREST array answer, with anything that isn't an object row dropped. */
export function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null) : [];
}
