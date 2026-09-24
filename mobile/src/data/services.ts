import { AuthService, SupabaseAuthService } from './auth';
import {
  AllocationStore, LabRotationCache, LabRotationStore, SupabaseAllocationStore, SupabaseLabRotationStore,
  SupabaseTimetableChangeStore, TimetableChangeCache, TimetableChangeStore,
} from './courseData';
import { DCU_API, DCUAPIClient, TimetableSource } from './dcuApi';
import { SupabaseREST } from './rest';
import {
  AppEvent, CachedRole, Emitter, ReporterID, SecretStore, SignedInUser, supabaseConfigFromEnv, SupabaseConfig,
  SupabaseSession,
} from './session';
import { AsyncKV, PrefKey, Prefs } from './storage';
import {
  CancellationStore, DeadlineStore, LocalCancellationStore, LocalDeadlineStore, LocalProfileStore, LocalVerdictStore,
  ProfileStore, SupabaseCancellationStore, SupabaseDeadlineStore, SupabaseProfileStore, SupabaseVerdictStore,
  VerdictStore,
} from './stores';
import { TimetableCache } from './timetable';

/**
 * Everything the screens talk to, built once at launch. What the factories did on iOS:
 * Supabase-backed stores when the project is configured, on-device ones when it isn't.
 */
export interface Services {
  prefs: Prefs;
  events: Emitter<AppEvent>;
  session: SupabaseSession;
  config: SupabaseConfig | null;
  user: SignedInUser;
  reporter: ReporterID;
  role: CachedRole;
  auth: AuthService | null;
  cancellations: CancellationStore;
  deadlines: DeadlineStore;
  verdicts: VerdictStore;
  profiles: ProfileStore;
  /** Null until Supabase is configured: a class list lives on the server or nowhere. */
  allocations: AllocationStore | null;
  labRotations: LabRotationStore | null;
  timetableChanges: TimetableChangeStore | null;
  rotationCache: LabRotationCache;
  changeCache: TimetableChangeCache;
  timetableCache: TimetableCache;
  /** Programme search and a picked programme's timetable. */
  dcu: DCUAPIClient;
  /** Replaces `dcu` for timetables when set — the preview fixtures. */
  sourceOverride: TimetableSource | null;
  /**
   * Everything this student left on the device goes, not just their credentials: the next
   * person to sign in here is a different person.
   */
  signOut(): void;
}

export interface Platform {
  kv: AsyncKV;
  secrets: SecretStore;
  env: Record<string, string | undefined>;
  fetchFn?: typeof fetch;
}

export async function createServices(platform: Platform): Promise<Services> {
  const prefs = new Prefs(platform.kv);
  await prefs.hydrate();
  const events = new Emitter<AppEvent>();
  const user = new SignedInUser(prefs);
  const fetchFn = platform.fetchFn ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const session = new SupabaseSession(
    platform.secrets,
    () => {
      // Forget who was signed in as well as the tokens, or every write would go out
      // anonymously while the screens still said they were signed in.
      user.forget();
      events.emit('authSessionExpired');
    },
    fetchFn,
  );
  await session.load();

  const config = supabaseConfigFromEnv(platform.env);
  const rest = config ? new SupabaseREST(config, session, fetchFn) : null;
  const reporter = new ReporterID(prefs, user);
  const role = new CachedRole(prefs);

  const services: Services = {
    prefs,
    events,
    session,
    config,
    user,
    reporter,
    role,
    auth: config ? new SupabaseAuthService(config, session, fetchFn) : null,
    cancellations: rest ? new SupabaseCancellationStore(rest) : new LocalCancellationStore(prefs),
    deadlines: rest ? new SupabaseDeadlineStore(rest) : new LocalDeadlineStore(prefs),
    verdicts: rest ? new SupabaseVerdictStore(rest) : new LocalVerdictStore(),
    profiles: rest ? new SupabaseProfileStore(rest) : new LocalProfileStore(user),
    allocations: rest ? new SupabaseAllocationStore(rest) : null,
    labRotations: rest ? new SupabaseLabRotationStore(rest) : null,
    timetableChanges: rest ? new SupabaseTimetableChangeStore(rest) : null,
    rotationCache: new LabRotationCache(prefs),
    changeCache: new TimetableChangeCache(prefs),
    timetableCache: new TimetableCache(platform.kv),
    // The API host is versioned (docs/API.md), so it can be moved without a code change.
    dcu: new DCUAPIClient(
      platform.env.EXPO_PUBLIC_DCU_API_BASE ? { ...DCU_API, apiBase: platform.env.EXPO_PUBLIC_DCU_API_BASE.replace(/\/+$/, '') } : DCU_API,
      fetchFn,
    ),
    sourceOverride: null,
    signOut() {
      user.forget();
      void session.clear();
      reporter.reset();
      role.reset();
      for (const key of [
        PrefKey.studentID, PrefKey.profile, PrefKey.selectedProgramme, PrefKey.hiddenGroups,
        PrefKey.skipped, PrefKey.allocationTried, PrefKey.useProgrammePicker,
      ]) {
        prefs.set(key, null);
      }
    },
  };
  return services;
}
