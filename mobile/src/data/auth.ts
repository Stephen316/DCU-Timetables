import { DCUEmail } from '../core/identity';
import { AuthenticatedUser, parseAuthSession, SupabaseConfig, SupabaseSession } from './session';

/** Why sign-in failed, in words for the student. */
export class AuthError extends Error {
  constructor(readonly kind: 'notConfigured' | 'emailNotConfirmed' | 'server', message: string) {
    super(message);
    this.name = 'UserFacingError';
  }

  static notConfigured(): AuthError {
    return new AuthError('notConfigured', "Sign-in isn't configured yet (missing EXPO_PUBLIC_SUPABASE_URL).");
  }

  /** The address exists but hasn't been confirmed, so the "check your email" step opens. */
  static emailNotConfirmed(): AuthError {
    return new AuthError('emailNotConfirmed', 'Confirm your DCU email address first.');
  }
}

export type SignUpOutcome =
  /** Supabase sent a confirmation email; the address must be confirmed before sign-in. */
  | { kind: 'needsEmailConfirmation' }
  /** Confirmations are switched off in Supabase, so the account is usable immediately. */
  | { kind: 'signedIn'; user: AuthenticatedUser };

export interface AuthService {
  signUp(email: DCUEmail, password: string): Promise<SignUpOutcome>;
  signIn(email: DCUEmail, password: string): Promise<AuthenticatedUser>;
  /** Send the confirmation email again to an address that hasn't been confirmed yet. */
  resendConfirmation(email: DCUEmail): Promise<void>;
  sendPasswordReset(email: DCUEmail): Promise<void>;
}

/**
 * Supabase Auth email-and-password sign-in, with the address confirmed by the link Supabase
 * emails.
 */
export class SupabaseAuthService implements AuthService {
  constructor(
    private readonly config: SupabaseConfig,
    private readonly session: SupabaseSession,
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
  ) {}

  async signUp(email: DCUEmail, password: string): Promise<SignUpOutcome> {
    const json = await this.post('/auth/v1/signup', { email: email.address, password });
    // A session only comes back when email confirmation is disabled.
    const session = parseAuthSession(json);
    if (session) {
      await this.session.save(session);
      return { kind: 'signedIn', user: { id: session.userID, address: email.address } };
    }
    return { kind: 'needsEmailConfirmation' };
  }

  async signIn(email: DCUEmail, password: string): Promise<AuthenticatedUser> {
    let json: unknown;
    try {
      json = await this.post('/auth/v1/token?grant_type=password', { email: email.address, password });
    } catch (error) {
      // Supabase reports an unconfirmed address as a plain sign-in failure; the form needs
      // to tell the two apart so it can open the confirmation step instead.
      if (error instanceof AuthError && error.kind === 'server' && isUnconfirmed(error.message)) {
        throw AuthError.emailNotConfirmed();
      }
      throw error;
    }
    const session = parseAuthSession(json);
    if (!session) throw new AuthError('server', "Couldn't sign in. Check your email and password.");
    // Every later write to Supabase is made as this student, which is what lets the
    // database check they own what they're changing.
    await this.session.save(session);
    return { id: session.userID, address: email.address };
  }

  async resendConfirmation(email: DCUEmail): Promise<void> {
    await this.post('/auth/v1/resend', { email: email.address, type: 'signup' });
  }

  async sendPasswordReset(email: DCUEmail): Promise<void> {
    await this.post('/auth/v1/recover', { email: email.address });
  }

  private async post(path: string, body: Record<string, string>): Promise<unknown> {
    const response = await this.fetchFn(this.config.url + path, {
      method: 'POST',
      headers: { apikey: this.config.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!response.ok) throw new AuthError('server', serverMessage(json, response.status));
    return json;
  }
}

function isUnconfirmed(message: string): boolean {
  const lowered = message.toLowerCase();
  return lowered.includes('not confirmed') || lowered.includes('email_not_confirmed');
}

/**
 * Supabase puts the useful text in `msg` or `error_description`; a bare status code would
 * leave the student with nothing actionable.
 */
export function serverMessage(json: unknown, status: number): string {
  if (typeof json === 'object' && json !== null) {
    for (const key of ['msg', 'error_description', 'message', 'error']) {
      const text = (json as Record<string, unknown>)[key];
      if (typeof text === 'string' && text.length > 0) return text;
    }
  }
  if (status === 429) return 'Too many attempts — wait a minute and try again.';
  return `Sign-in failed (${status}).`;
}
