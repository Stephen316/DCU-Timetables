/**
 * Where the app keeps what it remembers on the device.
 *
 * `Prefs` stands in for UserDefaults: small values, read synchronously. They live in
 * AsyncStorage, which is asynchronous, so everything under the prefix is read into memory
 * once at launch (`hydrate`) and every read after that is a map lookup. Writes update the
 * map at once and reach the disk behind it. Views subscribe to a key and re-render when it
 * changes, which is what `@AppStorage` did.
 *
 * Larger things — a week's timetable — go through `AsyncKV` directly and are read on demand.
 */
export interface AsyncKV {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
  multiGet(keys: readonly string[]): Promise<readonly (readonly [string, string | null])[]>;
}

/** An `AsyncKV` held in memory: tests, and a device where storage can't be reached. */
export class MemoryKV implements AsyncKV {
  readonly map = new Map<string, string>();
  async getItem(key: string) { return this.map.get(key) ?? null; }
  async setItem(key: string, value: string) { this.map.set(key, value); }
  async removeItem(key: string) { this.map.delete(key); }
  async getAllKeys() { return [...this.map.keys()]; }
  async multiGet(keys: readonly string[]) { return keys.map((k) => [k, this.map.get(k) ?? null] as const); }
}

type Listener = () => void;

export class Prefs {
  private readonly values = new Map<string, string>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private readonly backing: AsyncKV, private readonly prefix = 'pref:') {}

  /** Reads every saved value into memory. Called once, before the first screen draws. */
  async hydrate(): Promise<void> {
    try {
      const keys = (await this.backing.getAllKeys()).filter((k) => k.startsWith(this.prefix));
      for (const [key, value] of await this.backing.multiGet(keys)) {
        if (value !== null) this.values.set(key.slice(this.prefix.length), value);
      }
    } catch {
      // Unreadable storage starts the app empty rather than not at all.
    }
  }

  get(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  set(key: string, value: string | null): void {
    if (value === null) this.values.delete(key);
    else this.values.set(key, value);
    const full = this.prefix + key;
    // Chained so two quick writes to one key land in the order they were made.
    this.pending = this.pending
      .then(() => (value === null ? this.backing.removeItem(full) : this.backing.setItem(full, value)))
      .catch(() => undefined);
    this.listeners.get(key)?.forEach((fn) => fn());
  }

  getJSON<T>(key: string, fallback: T): T {
    const raw = this.get(key);
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  setJSON(key: string, value: unknown): void {
    this.set(key, value === undefined || value === null ? null : JSON.stringify(value));
  }

  getBool(key: string): boolean {
    return this.get(key) === 'true';
  }

  setBool(key: string, value: boolean): void {
    this.set(key, value ? 'true' : null);
  }

  subscribe(key: string, listener: Listener): () => void {
    const set = this.listeners.get(key) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(key, set);
    return () => {
      set.delete(listener);
    };
  }

  /** Resolves once every write made so far has reached storage. */
  flushed(): Promise<unknown> {
    return this.pending;
  }
}

/** The keys the app saves under, in one place so two screens can't spell one differently. */
export const PrefKey = {
  signedInUser: 'signedInUser',
  reporterID: 'cancellationReporterID',
  role: 'accountRole',
  studentID: 'studentID',
  profile: 'studentProfile',
  selectedProgramme: 'selectedProgramme',
  hiddenGroups: 'hiddenGroups',
  useProgrammePicker: 'useProgrammePicker',
  skipped: 'skippedEvents',
  allocationTried: 'allocationTried',
  weekShowsCalendar: 'weekShowsCalendar',
  engLabGroup: 'engLabGroup',
  appearance: 'appearance',
  labRotation: (courseKey: string) => `labRotation:${courseKey}`,
  timetableChanges: (courseKey: string) => `timetableChanges:${courseKey}`,
  localReports: 'local:cancellationReports',
  localDeadlines: 'local:deadlines',
  localConfirmations: 'local:deadlineConfirmations',
} as const;
