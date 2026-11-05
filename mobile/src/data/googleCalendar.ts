import { Platform } from 'react-native';
import { CalendarEntry, CalendarExport } from '../core/calendarExport';
import { GoogleCalendarRules } from '../core/googleCalendar';
import { PrefKey, Prefs } from './storage';

const API = 'https://www.googleapis.com/calendar/v3';
const SCRIPT = 'https://accounts.google.com/gsi/client';

interface TokenResponse { access_token?: string; error?: string; error_description?: string }
interface TokenClient { requestAccessToken(): void }
interface GoogleOAuth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
    error_callback?: (error: { type: string }) => void;
  }): TokenClient;
}

/** The student closed Google's window: not a failure, so nothing is said. */
export class GoogleSignInCancelled extends Error {
  constructor() {
    super('Signing in with Google was cancelled.');
  }
}

/** A refusal from the Calendar API, with Google's reason ("rateLimitExceeded") when it gave one. */
export class GoogleAPIError extends Error {
  constructor(readonly status: number, readonly reason: string | null) {
    super(status === 401
      ? 'Google signed the app out partway through. Try again.'
      : "Couldn't add the classes to Google Calendar. Try again.");
  }
}

/**
 * Add to Google Calendar in the web build: Google's own sign-in (Google Identity Services)
 * gives a token for `GoogleCalendarRules.scope` alone, and the classes go straight into a
 * "DCU Timetable" calendar through the Calendar API. Nothing passes through our server, and
 * the token is held only while the classes go in. The calendar's id is kept on this device,
 * so adding the year again fills the same calendar.
 */
export class GoogleCalendar {
  private client: TokenClient | null = null;
  private loading: Promise<void> | null = null;
  private pending: { resolve: (token: string) => void; reject: (error: Error) => void } | null = null;

  constructor(
    private readonly clientId: string,
    private readonly prefs: Prefs,
    private readonly fetchFn: typeof fetch,
  ) {}

  /** Android, where Google Calendar is the calendar and won't open an .ics: Google goes first. */
  static preferred(): boolean {
    return Platform.OS === 'web' && typeof navigator !== 'undefined' && /\bAndroid\b/.test(navigator.userAgent);
  }

  /**
   * Loads Google's sign-in ahead of the tap. The tap has to open Google's window with nothing
   * awaited before it, or the browser blocks it as a pop-up nobody asked for.
   */
  prepare(): Promise<void> {
    this.loading ??= loadGoogleOAuth()
      .then((oauth2) => {
        this.client = oauth2.initTokenClient({
          client_id: this.clientId,
          scope: GoogleCalendarRules.scope,
          callback: (response) => {
            if (response.access_token) this.settle((p) => p.resolve(response.access_token as string));
            else this.settle((p) => p.reject(new Error(response.error === 'access_denied'
              ? 'Google Calendar needs your permission to add the classes.'
              : "Google didn't let the app in. Try again.")));
          },
          error_callback: (error) => this.settle((p) => p.reject(
            error.type === 'popup_closed' ? new GoogleSignInCancelled()
              : error.type === 'popup_failed_to_open' ? new Error("The browser blocked Google's sign-in window. Allow pop-ups for this site, then try again.")
                : new Error("Couldn't reach Google. Try again."),
          )),
        });
      })
      .catch((error) => {
        this.loading = null;
        throw error;
      });
    return this.loading;
  }

  get ready(): boolean {
    return this.client !== null;
  }

  /** Opens Google's window. Call it from the tap itself, after `prepare` has finished. */
  signIn(): Promise<string> {
    if (!this.client) return Promise.reject(new Error("Google's sign-in hasn't loaded yet. Try again."));
    this.settle((p) => p.reject(new GoogleSignInCancelled()));
    const token = new Promise<string>((resolve, reject) => {
      this.pending = { resolve, reject };
    });
    this.client.requestAccessToken();
    return token;
  }

  /** Every class into the app's calendar, a few at a time; `onProgress` hears each one land. */
  async add(token: string, entries: CalendarEntry[], onProgress: (done: number) => void): Promise<void> {
    const calendarId = await this.calendar(token);
    const path = `/calendars/${encodeURIComponent(calendarId)}/events/import`;
    const queue = [...entries];
    let done = 0;
    let failed = false;
    const worker = async () => {
      while (!failed && queue.length > 0) {
        const entry = queue.shift() as CalendarEntry;
        try {
          await this.request(token, 'POST', path, GoogleCalendarRules.event(entry));
        } catch (error) {
          failed = true;
          throw error;
        }
        onProgress(++done);
      }
    };
    await Promise.all(Array.from({ length: Math.min(GoogleCalendarRules.concurrency, entries.length) }, worker));
  }

  /** The calendar made here before, if it's still there in this Google account; a new one if not. */
  private async calendar(token: string): Promise<string> {
    const saved = this.prefs.get(PrefKey.googleCalendar);
    if (saved) {
      const found = await this.request(token, 'GET', `/calendars/${encodeURIComponent(saved)}`).then(() => true, (error) => {
        // Deleted, or another Google account's: make one in this account instead.
        if (error instanceof GoogleAPIError && (error.status === 404 || error.status === 403)) return false;
        throw error;
      });
      if (found) return saved;
    }
    const created = await this.request(token, 'POST', '/calendars', {
      summary: CalendarExport.calendarName,
      description: 'Your classes, added by DCU Timetable. Add them again from the app to update them.',
      timeZone: GoogleCalendarRules.timeZone,
    }) as { id?: unknown };
    if (typeof created.id !== 'string') throw new Error("Google Calendar didn't make the calendar. Try again.");
    this.prefs.set(PrefKey.googleCalendar, created.id);
    return created.id;
  }

  /** One API call, waited out and tried again while Google says it's busy. */
  private async request(token: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    for (let attempt = 1; ; attempt++) {
      const response = await this.fetchFn(`${API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.ok) return response.json().catch(() => ({}));
      const reason = await response.json()
        .then((json: { error?: { errors?: { reason?: unknown }[] } }) => json.error?.errors?.[0]?.reason)
        .catch(() => null);
      const error = new GoogleAPIError(response.status, typeof reason === 'string' ? reason : null);
      if (attempt >= GoogleCalendarRules.maxAttempts || !GoogleCalendarRules.retryable(error.status, error.reason)) throw error;
      await new Promise((resolve) => setTimeout(resolve, GoogleCalendarRules.backoffMs(attempt)));
    }
  }

  private settle(action: (pending: { resolve: (token: string) => void; reject: (error: Error) => void }) => void): void {
    const pending = this.pending;
    this.pending = null;
    if (pending) action(pending);
  }
}

let script: Promise<GoogleOAuth2> | null = null;

/** Google's sign-in library, added to the page once and only when it's wanted. */
function loadGoogleOAuth(): Promise<GoogleOAuth2> {
  const loaded = () => (window as { google?: { accounts?: { oauth2?: GoogleOAuth2 } } }).google?.accounts?.oauth2;
  const existing = loaded();
  if (existing) return Promise.resolve(existing);
  script ??= new Promise<GoogleOAuth2>((resolve, reject) => {
    const tag = document.createElement('script');
    tag.src = SCRIPT;
    tag.async = true;
    tag.onload = () => {
      const oauth2 = loaded();
      if (oauth2) return resolve(oauth2);
      script = null;
      reject(new Error("Couldn't load Google's sign-in. Try again."));
    };
    tag.onerror = () => {
      script = null;
      tag.remove();
      reject(new Error("Couldn't reach Google. Check your connection and try again."));
    };
    document.head.appendChild(tag);
  });
  return script;
}
