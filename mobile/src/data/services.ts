import { ModuleAbbreviationCache, ModuleAbbreviationStore, SupabaseModuleAbbreviationStore } from './abbreviations';
import { AlertScheduler, MemoryAlertScheduler } from './alerts';
import { AuthService, SupabaseAuthService } from './auth';
import {
  AllocationStore, LabRotationCache, LabRotationStore, ModuleSplitCache, ModuleSplitStore, ModuleTitleCache,
  ModuleTitleStore, SupabaseAllocationStore, SupabaseLabRotationStore, SupabaseModuleSplitStore,
  SupabaseModuleTitleStore, SupabaseTimetableChangeStore, TimetableChangeCache, TimetableChangeStore,
} from './courseData';
import { DCU_API, DCUAPIClient, TimetableSource } from './dcuApi';
import { GoogleCalendar } from './googleCalendar';
import { SupabaseREST, withTimeLimit } from './rest';
import {
  AppEvent, CachedRole, Emitter, ReporterID, SecretStore, SignedInUser, supabaseConfigFromEnv, SupabaseConfig,
  SupabaseSession,
} from './session';
import { AsyncKV, PrefKey, Prefs } from './storage';
import {
  CancellationStore, DeadlineStore, LocalCancellationStore, LocalDeadlineStore, LocalProfileStore, LocalVerdictStore,
  PrivateDeadlineStore, ProfileStore, SupabaseCancellationStore, SupabaseDeadlineStore, SupabaseProfileStore, SupabaseVerdictStore,
  VerdictStore,
} from './stores';
import { TimetableCache } from './timetable';
import { SupabasePushSubscriptionStore, WebPush } from './webPush';

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
  moduleSplits: ModuleSplitStore | null;
  /** Headings set in the console. Null until Supabase is configured. */
  moduleTitles: ModuleTitleStore | null;
  /** Week-grid abbreviations set in the console. Null until Supabase is configured. */
  moduleAbbreviations: ModuleAbbreviationStore | null;
  rotationCache: LabRotationCache;
  changeCache: TimetableChangeCache;
  splitCache: ModuleSplitCache;
  titleCache: ModuleTitleCache;
  abbreviationCache: ModuleAbbreviationCache;
  timetableCache: TimetableCache;
  /** Programme search and a picked programme's timetable. */
  dcu: DCUAPIClient;
  /** Replaces `dcu` for timetables when set — the preview fixtures. */
  sourceOverride: TimetableSource | null;
  /** Class alerts on the phone or the Mac. Null in a browser, which has nothing to fire them. */
  alerts: AlertScheduler | null;
  /** Notifications pushed by the server, in the web build. Null everywhere else, and until Supabase is configured. */
  webPush: WebPush | null;
  /** Add to Google Calendar, in the web build in a browser once a Google client id is set. Null everywhere else. */
  googleCalendar: GoogleCalendar | null;
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
  /** Left out, one that fires nothing: tests, the preview. Null where alerts can't work at all. */
  alerts?: AlertScheduler | null;
  /** The web build in a browser, where the server pushes notifications instead. */
  webPush?: boolean;
  /** A browser, where Google's sign-in can open its window. */
  googleCalendar?: boolean;
}

export async function createServices(platform: Platform): Promise<Services> {
  const prefs = new Prefs(platform.kv);
  await prefs.hydrate();
  const events = new Emitter<AppEvent>();
  const user = new SignedInUser(prefs);
  // Every request the app makes gives up after REQUEST_TIME_LIMIT_MS, rather than leave a
  // screen loading for as long as the browser cares to wait.
  const fetchFn = withTimeLimit(platform.fetchFn ?? ((...args: Parameters<typeof fetch>) => fetch(...args)));
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
  const alerts = platform.alerts === undefined ? new MemoryAlertScheduler() : platform.alerts;
  const webPush = platform.webPush && rest
    ? new WebPush(new SupabasePushSubscriptionStore(rest), prefs, platform.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY?.trim() || null)
    : null;

  const googleClientId = platform.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID?.trim();
  const googleCalendar = platform.googleCalendar && googleClientId ? new GoogleCalendar(googleClientId, prefs, fetchFn) : null;

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
    deadlines: new PrivateDeadlineStore(rest ? new SupabaseDeadlineStore(rest) : new LocalDeadlineStore(prefs), prefs, () => reporter.current),
    verdicts: rest ? new SupabaseVerdictStore(rest) : new LocalVerdictStore(),
    profiles: rest ? new SupabaseProfileStore(rest) : new LocalProfileStore(user),
    allocations: rest ? new SupabaseAllocationStore(rest) : null,
    labRotations: rest ? new SupabaseLabRotationStore(rest) : null,
    timetableChanges: rest ? new SupabaseTimetableChangeStore(rest) : null,
    moduleSplits: rest ? new SupabaseModuleSplitStore(rest) : null,
    moduleTitles: rest ? new SupabaseModuleTitleStore(rest) : null,
    moduleAbbreviations: rest ? new SupabaseModuleAbbreviationStore(rest) : null,
    rotationCache: new LabRotationCache(prefs),
    changeCache: new TimetableChangeCache(prefs),
    splitCache: new ModuleSplitCache(prefs),
    titleCache: new ModuleTitleCache(prefs),
    abbreviationCache: new ModuleAbbreviationCache(prefs),
    timetableCache: new TimetableCache(platform.kv),
    // The API host is versioned (docs/API.md), so it can be moved without a code change.
    dcu: new DCUAPIClient(
      platform.env.EXPO_PUBLIC_DCU_API_BASE ? { ...DCU_API, apiBase: platform.env.EXPO_PUBLIC_DCU_API_BASE.replace(/\/+$/, '') } : DCU_API,
      fetchFn,
      prefs,
    ),
    sourceOverride: null,
    alerts,
    webPush,
    googleCalendar,
    signOut() {
      // First, while who's signed in is still known: nothing more reaches this browser.
      webPush?.forget();
      user.forget();
      void session.clear();
      reporter.reset();
      role.reset();
      for (const key of [
        PrefKey.studentID, PrefKey.profile, PrefKey.selectedProgramme, PrefKey.programmeSaved,
        PrefKey.skipped, PrefKey.timetableEdits, PrefKey.tutorialDue, PrefKey.allocationTried, PrefKey.subgroupQuestion,
        PrefKey.contributionsTold,
      ]) {
        prefs.set(key, null);
      }
      // Last, so nothing re-planned while the rest was cleared survives: the next person to
      // sign in here shouldn't be told where this one's classes are.
      void alerts?.clear();
    },
  };
  return services;
}
