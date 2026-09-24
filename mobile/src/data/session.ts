import { AppRole, DCUEmail, parseDCUEmail, parseRole } from '../core/identity';
import { uuid } from '../core/uuid';
import { Prefs, PrefKey } from './storage';

// MARK: - Config

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

/**
 * Read from `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` (a git-ignored
 * `.env` locally, EAS secrets for a build). Absent config means the app falls back to the
 * on-device stores, as the iOS app did without `supabase.local.json`.
 */
export function supabaseConfigFromEnv(env: Record<string, string | undefined>): SupabaseConfig | null {
  const url = env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  return { url: url.replace(/\/+$/, ''), anonKey };
}

// MARK: - Events

type Handler = () => void;

/** The app's few broadcast messages — what NotificationCenter carried on iOS. */
export class Emitter<Name extends string> {
  private readonly handlers = new Map<Name, Set<Handler>>();

  on(name: Name, handler: Handler): () => void {
    const set = this.handlers.get(name) ?? new Set<Handler>();
    set.add(handler);
    this.handlers.set(name, set);
    return () => {
      set.delete(handler);
    };
  }

  emit(name: Name): void {
    this.handlers.get(name)?.forEach((h) => h());
  }
}

export type AppEvent =
  /** The refresh token is dead and the student has been signed out. */
  | 'authSessionExpired'
  /** Something deep in the app wants the student signed out and the device wiped. */
  | 'signOutRequested'
  /** The rotation on this device changed; anything showing labs should rebuild. */
  | 'labRotationChanged'
  /** The saved changes on this device changed; the week view re-applies them. */
  | 'timetableChangesChanged';

// MARK: - Tokens

/** The signed-in student's Supabase tokens. */
export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  /** Milliseconds since 1970. */
  expiresAt: number;
  userID: string;
}

/** Treated as expired a minute early, so a request never sets off with a dying token. */
export function isSessionValid(session: AuthSession, now: number = Date.now()): boolean {
  return session.expiresAt - now > 60_000;
}

/** Reads Supabase's token response, which has the same shape from sign-in, sign-up and refresh. */
export function parseAuthSession(json: unknown, now: number = Date.now()): AuthSession | null {
  if (typeof json !== 'object' || json === null) return null;
  const j = json as Record<string, unknown>;
  const user = j.user as Record<string, unknown> | undefined;
  if (typeof j.access_token !== 'string' || typeof j.refresh_token !== 'string' || typeof user?.id !== 'string') {
    return null;
  }
  // `expires_in` is seconds; `expires_at` is a unix timestamp. Either may be present.
  const expiresAt =
    typeof j.expires_at === 'number'
      ? j.expires_at * 1000
      : now + (typeof j.expires_in === 'number' ? j.expires_in : 3600) * 1000;
  return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt, userID: user.id };
}

/** Somewhere to keep the one secret the app holds. The Keychain on iOS. */
export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/**
 * Holds the session and hands out a usable access token, refreshing it when it has aged
 * out. Concurrent callers share one refresh.
 */
export class SupabaseSession {
  private static readonly key = 'session';
  private cached: AuthSession | null = null;
  private refreshing: Promise<AuthSession | null> | null = null;

  constructor(
    private readonly secrets: SecretStore,
    private readonly onExpired: () => void,
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
  ) {}

  /** Reads the stored session. Called once at launch. */
  async load(): Promise<void> {
    try {
      const raw = await this.secrets.get(SupabaseSession.key);
      this.cached = raw ? (JSON.parse(raw) as AuthSession) : null;
    } catch {
      this.cached = null;
    }
  }

  async save(session: AuthSession): Promise<void> {
    this.cached = session;
    await this.secrets.set(SupabaseSession.key, JSON.stringify(session)).catch(() => undefined);
  }

  async clear(): Promise<void> {
    this.cached = null;
    await this.secrets.remove(SupabaseSession.key).catch(() => undefined);
  }

  get userID(): string | null {
    return this.cached?.userID ?? null;
  }

  /**
   * A live access token, or null when nobody is signed in and nothing can be refreshed.
   * Callers fall back to the anon key, which RLS treats as an anonymous client.
   */
  async accessToken(config: SupabaseConfig): Promise<string | null> {
    const current = this.cached;
    if (!current) return null;
    if (isSessionValid(current)) return current.accessToken;
    this.refreshing ??= this.refresh(current, config).finally(() => {
      this.refreshing = null;
    });
    const refreshed = await this.refreshing;
    if (!refreshed) {
      // The refresh token is dead. The UI must hear about it, or it keeps showing the
      // student as signed in while every write is silently rejected.
      if (this.cached === current) {
        await this.clear();
        this.onExpired();
      }
      return null;
    }
    await this.save(refreshed);
    return refreshed.accessToken;
  }

  private async refresh(current: AuthSession, config: SupabaseConfig): Promise<AuthSession | null> {
    try {
      const response = await this.fetchFn(`${config.url}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { apikey: config.anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: current.refreshToken }),
      });
      if (!response.ok) return null;
      return parseAuthSession(await response.json());
    } catch {
      return null;
    }
  }
}

// MARK: - Who is using the device

/** A student who has proved they control a DCU address. */
export interface AuthenticatedUser {
  /** Supabase user id — stable across reinstalls. */
  id: string;
  address: string;
}

export function userEmail(user: AuthenticatedUser): DCUEmail | null {
  return parseDCUEmail(user.address);
}

/** Remembers who is signed in. No password or token — only the address and user id. */
export class SignedInUser {
  constructor(private readonly prefs: Prefs) {}

  get current(): AuthenticatedUser | null {
    const user = this.prefs.getJSON<AuthenticatedUser | null>(PrefKey.signedInUser, null);
    return user && typeof user.id === 'string' && typeof user.address === 'string' ? user : null;
  }

  save(user: AuthenticatedUser): void {
    this.prefs.setJSON(PrefKey.signedInUser, user);
  }

  forget(): void {
    this.prefs.set(PrefKey.signedInUser, null);
  }
}

/**
 * The id a vote is counted under. A signed-in student is the same person across reinstalls;
 * otherwise an anonymous per-install id, so one device can't flag a class by reporting
 * repeatedly.
 */
export class ReporterID {
  constructor(private readonly prefs: Prefs, private readonly user: SignedInUser) {}

  get current(): string {
    const signedIn = this.user.current;
    if (signedIn) return signedIn.id;
    const existing = this.prefs.get(PrefKey.reporterID);
    if (existing) return existing;
    const fresh = uuid();
    this.prefs.set(PrefKey.reporterID, fresh);
    return fresh;
  }

  /** Dropped on sign-out: the next person to use this device is a different voter. */
  reset(): void {
    this.prefs.set(PrefKey.reporterID, null);
  }
}

/**
 * The last role the server reported, so a menu can render without waiting on a request. A
 * cache, never a decision: the database enforces what it merely hints at.
 */
export class CachedRole {
  constructor(private readonly prefs: Prefs) {}

  get current(): AppRole {
    return parseRole(this.prefs.get(PrefKey.role)) ?? 'student';
  }

  save(role: AppRole): void {
    this.prefs.set(PrefKey.role, role);
  }

  reset(): void {
    this.prefs.set(PrefKey.role, null);
  }
}
