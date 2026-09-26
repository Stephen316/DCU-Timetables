import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  cancellationEventKey,
  createStudentDataService,
  isTauri,
  supabase,
  type AccountProfile,
  type AllocationResolution,
  type AuthenticatedUser,
  type CancellationStatus,
  type DeadlineKind,
  type DeadlineStanding,
  type EventVerdict,
  type ModuleDeadline,
  type Profile,
  type ReportStance,
  type StudentDataService,
  type TeachingWeek,
  type TimetableCategory,
  type TimetableEvent,
  type WeekCalendar,
} from "./data";
import type { DayOption } from "./types";

type Page = "timetable" | "groups" | "labs" | "deadlines" | "account";
type ViewMode = "day" | "week";
type AuthMode = "signin" | "signup";

const dataService: StudentDataService | null = supabase
  ? createStudentDataService({ supabase })
  : null;
const ENGINEERING_COURSE = "EEG1";
const TIME_ZONE = "Europe/Dublin";
const APP_LINKS = {
  privacy: "https://stephen316.github.io/DCU-Timetables/privacy.html",
  terms: "https://stephen316.github.io/DCU-Timetables/terms.html",
  support: "https://stephen316.github.io/DCU-Timetables/support.html",
};
const OFFLINE_PROFILE_KEY = "dcu-timetable:offline-profile:";
const TIMETABLE_CACHE_PREFIX = "dcu-timetable:v1:";

interface OfflineProfileSnapshot {
  user: AuthenticatedUser;
  account: AccountProfile;
  resolved: Profile;
  savedAt: string;
}

function localSupabaseUser(): AuthenticatedUser | null {
  const configuredUrl = import.meta.env.VITE_SUPABASE_URL;
  if (!supabase || !configuredUrl) return null;
  try {
    const projectRef = new URL(configuredUrl).hostname.split(".")[0];
    const savedSession = localStorage.getItem(`sb-${projectRef}-auth-token`);
    if (!savedSession) return null;
    const session = JSON.parse(savedSession) as {
      access_token?: unknown;
      refresh_token?: unknown;
      user?: { id?: unknown; email?: unknown };
    };
    const id = session.user?.id;
    const email = session.user?.email;
    return typeof session.access_token === "string" && typeof session.refresh_token === "string"
      && typeof id === "string" && typeof email === "string" ? { id, email } : null;
  } catch {
    return null;
  }
}

function offlineSnapshotFor(user: AuthenticatedUser): OfflineProfileSnapshot | null {
  try {
    const snapshot = JSON.parse(localStorage.getItem(`${OFFLINE_PROFILE_KEY}${user.id}`) ?? "null") as OfflineProfileSnapshot | null;
    if (!snapshot || snapshot.user.id !== user.id || snapshot.account.id !== user.id
      || snapshot.resolved.id !== user.id || snapshot.resolved.allocationStatus !== "matched"
      || !snapshot.resolved.group || snapshot.user.email.trim().toLowerCase() !== user.email.trim().toLowerCase()) return null;
    return snapshot;
  } catch {
    return null;
  }
}

function persistOfflineProfile(user: AuthenticatedUser, resolved: Profile): void {
  if (navigator.onLine === false || resolved.id !== user.id || resolved.allocationStatus !== "matched" || !resolved.group) return;
  const account: AccountProfile = {
    id: resolved.id,
    role: resolved.role,
    pi: resolved.pi,
    displayName: resolved.displayName,
    bannedUntil: resolved.bannedUntil,
    studentId: resolved.studentId,
  };
  try {
    localStorage.setItem(`${OFFLINE_PROFILE_KEY}${user.id}`, JSON.stringify({
      user, account, resolved, savedAt: new Date().toISOString(),
    } satisfies OfflineProfileSnapshot));
  } catch {
    // Keep online onboarding usable if browser storage is blocked or full.
  }
}

function clearOfflineProfile(userId: string | null): void {
  if (!userId) return;
  try {
    localStorage.removeItem(`${OFFLINE_PROFILE_KEY}${userId}`);
    localStorage.removeItem(`dcu-timetable:programme:${userId}`);
  } catch {
    // Storage can be unavailable in hardened browser contexts.
  }
}

function cachedProfileCalendar(profile: Profile): WeekCalendar | null {
  try {
    const envelope = JSON.parse(localStorage.getItem(`${TIMETABLE_CACHE_PREFIX}week-calendar`) ?? "null") as
      { value?: WeekCalendar } | null;
    const calendar = envelope?.value;
    if (!calendar || !Array.isArray(calendar.weeks) || !Array.isArray(calendar.days)) return null;
    const hasAnyWeek = cachedProfileWeekNumbers(profile, calendar).length > 0;
    return hasAnyWeek ? calendar : null;
  } catch {
    return null;
  }
}

function cachedProfileWeekNumbers(profile: Profile, calendar: WeekCalendar): number[] {
  const course = profile.courseKey ?? ENGINEERING_COURSE;
  return calendar.weeks.filter((week) => {
    try {
      const key = `${TIMETABLE_CACHE_PREFIX}profile-events:${profile.id}:${course}:${profile.group}:${profile.subgroup ?? ""}:${week.number}`;
      const cached = JSON.parse(localStorage.getItem(key) ?? "null") as { value?: unknown } | null;
      return Array.isArray(cached?.value);
    } catch {
      return false;
    }
  }).map((week) => week.number);
}

function cachedProfileEvents(profile: Profile, week: TeachingWeek): TimetableEvent[] | null {
  try {
    const key = `${TIMETABLE_CACHE_PREFIX}profile-events:${profile.id}:${profile.courseKey ?? ENGINEERING_COURSE}:${profile.group}:${profile.subgroup ?? ""}:${week.number}`;
    const cached = JSON.parse(localStorage.getItem(key) ?? "null") as { value?: unknown } | null;
    return Array.isArray(cached?.value) ? cached.value as TimetableEvent[] : null;
  } catch {
    return null;
  }
}

const kindOptions: Array<{ value: DeadlineKind; label: string }> = [
  { value: "assignment", label: "Assignment" },
  { value: "labReport", label: "Lab report" },
  { value: "quiz", label: "Quiz" },
  { value: "exam", label: "Exam" },
  { value: "presentation", label: "Presentation" },
  { value: "other", label: "Other" },
];

const weekdayOptions: DayOption[] = [
  { name: "Mon", dayOfWeek: 1 }, { name: "Tue", dayOfWeek: 2 }, { name: "Wed", dayOfWeek: 3 },
  { name: "Thu", dayOfWeek: 4 }, { name: "Fri", dayOfWeek: 5 },
];

function initials(name: string): string {
  return name.split(/[.@\s_-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function displayName(user: AuthenticatedUser, profile: AccountProfile | null): string {
  return profile?.displayName?.trim() || user.email.split("@")[0].replace(/[._-]+/g, " ");
}

function clock(value: string): string {
  return new Intl.DateTimeFormat("en-IE", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
}

function dublinDateKey(value: Date | string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dayForWeek(week: TeachingWeek, index: number): Date {
  const [year, month, day] = dublinDateKey(week.firstDay).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + index, 12));
}

function sameLocalDay(value: string, day: Date): boolean {
  return dublinDateKey(value) === dublinDateKey(day);
}

function monthDay(value: string | Date): string {
  return new Intl.DateTimeFormat("en-IE", { timeZone: TIME_ZONE, month: "short", day: "numeric" }).format(new Date(value));
}

function countdown(value: string): string {
  const [year, month, day] = dublinDateKey(value).split("-").map(Number);
  const [nowYear, nowMonth, nowDay] = dublinDateKey(new Date()).split("-").map(Number);
  const days = Math.round((Date.UTC(year, month - 1, day) - Date.UTC(nowYear, nowMonth - 1, nowDay)) / 86400000);
  if (days < 0) return "Past due";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `${days} days`;
}

function dublinWeekday(value: Date | string): number {
  const weekday = new Intl.DateTimeFormat("en-IE", { timeZone: TIME_ZONE, weekday: "short" }).format(new Date(value));
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekday);
}

function dublinInstant(localValue: string): Date {
  const [date, time] = localValue.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  let guess = wanted;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
    guess += wanted - Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  }
  return new Date(guess);
}

function dublinInputValue(instant: string | null | undefined): string {
  if (!instant) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

function fallbackCalendar(): WeekCalendar {
  const [year, month, day] = dublinDateKey(new Date()).split("-").map(Number);
  const monday = new Date(Date.UTC(year, month - 1, day - dublinWeekday(new Date()), 12));
  return {
    weeks: [{ number: 0, label: "Offline", firstDay: monday.toISOString() }],
    days: weekdayOptions,
  };
}

function isSatInClass(kind: DeadlineKind): boolean {
  return kind === "quiz" || kind === "exam";
}

function getOverlaps(events: TimetableEvent[]): Set<string> {
  const clashes = new Set<string>();
  for (let i = 0; i < events.length; i += 1) {
    for (let j = i + 1; j < events.length; j += 1) {
      const left = events[i];
      const right = events[j];
      if (left.id !== right.id && Date.parse(effectiveStart(left)) < Date.parse(effectiveEnd(right))
        && Date.parse(effectiveStart(right)) < Date.parse(effectiveEnd(left))) {
        clashes.add(left.id);
        clashes.add(right.id);
      }
    }
  }
  return clashes;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function hasActiveVerdict(event: TimetableEvent): boolean {
  return event.verdict != null;
}

function effectiveStart(event: TimetableEvent): string {
  return event.verdict?.startOverride ?? event.start;
}

function effectiveEnd(event: TimetableEvent): string {
  if (!event.verdict?.startOverride) return event.end;
  const shifted = Date.parse(event.verdict.startOverride) + Date.parse(event.end) - Date.parse(event.start);
  return Number.isFinite(shifted) ? new Date(shifted).toISOString() : event.end;
}

function maySetVerdict(profile: AccountProfile | null): boolean {
  if (!profile || (profile.role !== "trusted" && profile.role !== "admin")) return false;
  return !profile.bannedUntil || Date.parse(profile.bannedUntil) <= Date.now();
}

function Icon({ children }: { children: string }) {
  return <span className="nav-icon" aria-hidden="true">{children}</span>;
}

function Brand() {
  return <a className="brand" href="#timetable" aria-label="DCU timetable home">
    <span className="brand-mark">D</span><span className="brand-name">DCU <span>timetable</span></span>
  </a>;
}

function App() {
  const [stage, setStage] = useState<"checking" | "auth" | "studentId" | "resolvingProfile" | "subgroup" | "profileIssue" | "programme" | "app">("checking");
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [studentProfile, setStudentProfile] = useState<Profile | null>(null);
  const [subgroupOptions, setSubgroupOptions] = useState<string[]>([]);
  const [profileIssue, setProfileIssue] = useState<AllocationResolution["status"] | "missingProfile" | "lookupFailed" | null>(null);
  const [usingProgramme, setUsingProgramme] = useState(false);
  const [cachedCalendarNotice, setCachedCalendarNotice] = useState(false);
  const [calendarUnavailable, setCalendarUnavailable] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("signin");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [studentNumber, setStudentNumber] = useState("");
  const [studentIdBusy, setStudentIdBusy] = useState(false);
  const [page, setPage] = useState<Page>("timetable");
  const [programme, setProgramme] = useState<TimetableCategory | null>(null);
  const [calendar, setCalendar] = useState<WeekCalendar | null>(null);
  const [weekIndex, setWeekIndex] = useState(0);
  const [dayIndex, setDayIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [eventsByWeek, setEventsByWeek] = useState<Record<number, TimetableEvent[]>>({});
  const [weekLoading, setWeekLoading] = useState(false);
  const [programmeQuery, setProgrammeQuery] = useState("");
  const [programmeResults, setProgrammeResults] = useState<TimetableCategory[]>([]);
  const [programmeLoading, setProgrammeLoading] = useState(false);
  const [programmeError, setProgrammeError] = useState("");
  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(new Set());
  const [skippedEventKeys, setSkippedEventKeys] = useState<Set<string>>(new Set());
  const [attendanceOwner, setAttendanceOwner] = useState<string | null>(null);
  const [appearance, setAppearance] = useState<"system" | "light" | "dark">(() => {
    const saved = localStorage.getItem("dcu-timetable:appearance");
    return saved === "light" || saved === "dark" ? saved : "system";
  });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const [piCopied, setPiCopied] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<TimetableEvent | null>(null);
  const [cancellations, setCancellations] = useState<Record<string, CancellationStatus>>({});
  const [deadlines, setDeadlines] = useState<ModuleDeadline[]>([]);
  const [selectedDeadline, setSelectedDeadline] = useState<ModuleDeadline | null>(null);
  const [deadlineStandings, setDeadlineStandings] = useState<Record<string, DeadlineStanding>>({});
  const [deadlineModal, setDeadlineModal] = useState(false);
  const [deadlineTitle, setDeadlineTitle] = useState("");
  const [deadlineModule, setDeadlineModule] = useState("");
  const [deadlineGroup, setDeadlineGroup] = useState("");
  const [deadlineDue, setDeadlineDue] = useState("");
  const [deadlineKind, setDeadlineKind] = useState<DeadlineKind>("assignment");
  const [deadlineBusy, setDeadlineBusy] = useState(false);
  const [deadlineFilter, setDeadlineFilter] = useState("All");
  const [deadlineSearch, setDeadlineSearch] = useState("");
  const [detailBusy, setDetailBusy] = useState(false);
  const [deadlineReportReason, setDeadlineReportReason] = useState<"offensive" | "spam" | "wrong" | "other">("wrong");
  const [hiddenAuthorCount, setHiddenAuthorCount] = useState(0);
  const [trustedVerdictNote, setTrustedVerdictNote] = useState("");
  const [trustedVerdictRoom, setTrustedVerdictRoom] = useState("");
  const [trustedVerdictStart, setTrustedVerdictStart] = useState("");
  const [online, setOnline] = useState(typeof navigator === "undefined" || navigator.onLine);
  const [offlineWarning, setOfflineWarning] = useState(false);
  const [reportsUnavailable, setReportsUnavailable] = useState(false);
  const [deadlinesUnavailable, setDeadlinesUnavailable] = useState(false);
  const [offlineRestored, setOfflineRestored] = useState(false);
  const [toast, setToast] = useState("");
  const [globalError, setGlobalError] = useState("");
  const activeUserId = useRef<string | null>(null);
  const service = dataService;

  useEffect(() => {
    const onlineHandler = () => setOnline(true);
    const offlineHandler = () => setOnline(false);
    window.addEventListener("online", onlineHandler);
    window.addEventListener("offline", offlineHandler);
    return () => {
      window.removeEventListener("online", onlineHandler);
      window.removeEventListener("offline", offlineHandler);
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setSkippedEventKeys(new Set());
      setAttendanceOwner(null);
      return;
    }
    setAttendanceOwner(null);
    try {
      const stored = JSON.parse(localStorage.getItem(`dcu-timetable:attendance:${user.id}`) ?? "[]") as string[];
      setSkippedEventKeys(new Set(stored));
    } catch {
      setSkippedEventKeys(new Set());
    }
    setAttendanceOwner(user.id);
  }, [user]);

  useEffect(() => {
    if (user && attendanceOwner === user.id) {
      localStorage.setItem(`dcu-timetable:attendance:${user.id}`, JSON.stringify([...skippedEventKeys]));
    }
  }, [user, attendanceOwner, skippedEventKeys]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const resolvedAppearance = appearance === "system" ? (systemDark ? "dark" : "light") : appearance;

  useEffect(() => {
    localStorage.setItem("dcu-timetable:appearance", appearance);
    document.documentElement.dataset.theme = resolvedAppearance;
  }, [appearance, resolvedAppearance]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    activeUserId.current = user?.id ?? null;
  }, [user]);

  useEffect(() => {
    let active = true;
    if (!service) {
      setStage("auth");
      return () => { active = false; };
    }
    void (async () => {
      if (navigator.onLine === false) {
        const localUser = localSupabaseUser();
        const snapshot = localUser ? offlineSnapshotFor(localUser) : null;
        const savedCalendar = snapshot ? cachedProfileCalendar(snapshot.resolved) : null;
        const cachedWeeks = snapshot && savedCalendar
          ? savedCalendar.weeks.flatMap((week) => {
            const events = cachedProfileEvents(snapshot.resolved, week);
            return events ? [[week, events] as const] : [];
          }) : [];
        if (!localUser || !snapshot || !savedCalendar || !cachedWeeks.length) {
          setStage("auth");
          setGlobalError("You're offline. Reconnect to verify your account or load a saved profile timetable.");
          return;
        }
        const todayKey = dublinDateKey(new Date());
        const currentIndex = savedCalendar.weeks.findIndex((week) => {
          const start = dublinDateKey(week.firstDay);
          const [year, month, day] = start.split("-").map(Number);
          const end = dublinDateKey(new Date(Date.UTC(year, month - 1, day + 6, 12)));
          return todayKey >= start && todayKey <= end;
        });
        const selectedIndex = cachedWeeks
          .map(([week]) => savedCalendar.weeks.findIndex((item) => item.number === week.number))
          .filter((index) => index >= 0)
          .sort((left, right) => Math.abs(left - Math.max(currentIndex, 0)) - Math.abs(right - Math.max(currentIndex, 0)))[0];
        if (selectedIndex == null) {
          setStage("auth");
          setGlobalError("You're offline and no saved timetable week is available. Reconnect to refresh your schedule.");
          return;
        }
        setUser(localUser);
        setOfflineRestored(true);
        setProfile(snapshot.account);
        setStudentProfile(snapshot.resolved);
        setCalendar(savedCalendar);
        setCalendarUnavailable(false);
        setCachedCalendarNotice(true);
        setOfflineWarning(true);
        setReportsUnavailable(true);
        setDeadlinesUnavailable(true);
        setUsingProgramme(false);
        setProgramme(null);
        setWeekIndex(selectedIndex);
        setDayIndex(Math.min(dublinWeekday(new Date()), 4));
        setPage("timetable");
        setStage("app");
        setGlobalError("");
        try {
          const key = `dcu-timetable:groups:${localUser.id}:profile:${snapshot.resolved.courseKey ?? ENGINEERING_COURSE}:${snapshot.resolved.group}:${snapshot.resolved.subgroup ?? ""}`;
          setHiddenGroups(new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]));
        } catch {
          setHiddenGroups(new Set());
        }
        setEventsByWeek(Object.fromEntries(cachedWeeks.map(([week, events]) => [week.number, events])));
        setWeekLoading(false);
        return;
      }
      try {
        const current = await service.currentUser();
        if (!active) return;
        if (!current) { setStage("auth"); return; }
        setUser(current);
        const currentProfile = await service.myProfile();
        if (!active) return;
        setProfile(currentProfile);
        if (!currentProfile) {
          setGlobalError("Your account is signed in, but its student profile could not be loaded. Retry signing in to refresh your profile.");
          setStage("auth");
        } else if (!currentProfile.studentId) setStage("studentId");
        else setStage("resolvingProfile");
      } catch (error) {
        if (!active) return;
        setGlobalError(errorMessage(error, "Couldn't restore your session."));
        setStage("auth");
      }
    })();
    return () => { active = false; };
  }, [service]);

  useEffect(() => {
    if (!online || !offlineRestored || !service) return;
    let active = true;
    void (async () => {
      setStage("checking");
      try {
        const verifiedUser = await service.currentUser();
        if (!active) return;
        if (!verifiedUser) {
          clearOfflineProfile(activeUserId.current);
          setUser(null);
          setProfile(null);
          setStudentProfile(null);
          setOfflineRestored(false);
          setStage("auth");
          return;
        }
        setUser(verifiedUser);
        const currentProfile = await service.myProfile();
        if (!active) return;
        setProfile(currentProfile);
        setOfflineRestored(false);
        if (!currentProfile) {
          setGlobalError("Reconnect and sign in again to verify your student profile.");
          setStage("auth");
        } else if (!currentProfile.studentId) {
          setStage("studentId");
        } else {
          setStage("resolvingProfile");
        }
      } catch (error) {
        if (!active) return;
        setOfflineRestored(false);
        setGlobalError(errorMessage(error, "Couldn't verify your account after reconnecting."));
        setStage("auth");
      }
    })();
    return () => { active = false; };
  }, [online, offlineRestored, service]);

  useEffect(() => {
    if (!supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_OUT") return;
      clearOfflineProfile(activeUserId.current);
      activeUserId.current = null;
      setUser(null);
      setProfile(null);
      setStudentProfile(null);
      setProgramme(null);
      setCalendar(null);
      setEventsByWeek({});
      setSelectedDeadline(null);
      setHiddenGroups(new Set());
      setSelectedEvent(null);
      setDeadlines([]);
      setCancellations({});
      setDeadlineStandings({});
      setProfileIssue(null);
      setStudentNumber("");
      setGlobalError("");
      setStage("auth");
      setPage("timetable");
    });
    return () => subscription.unsubscribe();
  }, []);

  const notify = useCallback((message: string) => setToast(message), []);

  const handleAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError("");
    setAuthNotice("");
    setGlobalError("");
    const domain = authEmail.trim().toLowerCase().split("@").at(-1);
    if (!authEmail.includes("@") || !["dcu.ie", "mail.dcu.ie"].includes(domain ?? "")) {
      setAuthError("Use your @dcu.ie or @mail.dcu.ie student email.");
      return;
    }
    if (!service) {
      setAuthError("Connect Supabase to enable student accounts. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in desktop/.env.local.");
      return;
    }
    if (authMode === "signup" && authPassword !== confirmPassword) {
      setAuthError("Those passwords don't match.");
      return;
    }
    if (authMode === "signup" && (authPassword.length < 8 || !/[A-Z]/.test(authPassword)
      || !/[a-z]/.test(authPassword) || !/[0-9]/.test(authPassword))) {
      setAuthError("Use at least 8 characters, with a capital letter, a lower-case letter and a number.");
      return;
    }
    setAuthBusy(true);
    try {
      if (authMode === "signup") {
        const result = await service.signUp(authEmail, authPassword);
        if (result.needsEmailConfirmation) {
          setAuthNotice(`Check ${authEmail} for a confirmation link, then come back and sign in.`);
          setAuthMode("signin");
          setAuthPassword("");
          setConfirmPassword("");
        } else if (result.user) {
          setUser(result.user);
          setProfile(result.profile);
          setStage(!result.profile ? "profileIssue" : result.profile.studentId ? "resolvingProfile" : "studentId");
          if (!result.profile) setProfileIssue("missingProfile");
        }
      } else {
        const result = await service.signIn(authEmail, authPassword);
        setUser(result.user);
        setProfile(result.profile);
        setStage(!result.profile ? "profileIssue" : result.profile.studentId ? "resolvingProfile" : "studentId");
        if (!result.profile) setProfileIssue("missingProfile");
      }
    } catch (error) {
      setAuthError(errorMessage(error, "Couldn't complete that request. Please try again."));
    } finally {
      setAuthBusy(false);
    }
  };

  const requestPasswordReset = async () => {
    if (!service || !authEmail.trim()) {
      setAuthError("Enter the email address for your account first.");
      return;
    }
    const domain = authEmail.trim().toLowerCase().split("@").at(-1);
    if (!["dcu.ie", "mail.dcu.ie"].includes(domain ?? "")) {
      setAuthError("Use your @dcu.ie or @mail.dcu.ie student email.");
      return;
    }
    setAuthError("");
    try {
      await service.sendPasswordReset(authEmail);
      setAuthNotice(`If an account exists for ${authEmail}, a password reset link is on its way.`);
    } catch (error) {
      setAuthError(errorMessage(error, "Couldn't send a password reset."));
    }
  };

  const resendConfirmation = async () => {
    if (!service) return;
    setAuthError("");
    const domain = authEmail.trim().toLowerCase().split("@").at(-1);
    if (!["dcu.ie", "mail.dcu.ie"].includes(domain ?? "")) {
      setAuthError("Use your @dcu.ie or @mail.dcu.ie student email.");
      return;
    }
    try {
      await service.resendConfirmation(authEmail);
      setAuthNotice(`A new confirmation link was sent to ${authEmail}.`);
    } catch (error) {
      setAuthError(errorMessage(error, "Couldn't resend the confirmation email."));
    }
  };

  const handleStudentNumber = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!service) return;
    setStudentIdBusy(true);
    setGlobalError("");
    try {
      const saved = await service.setStudentNumber(studentNumber);
      const freshProfile = await service.myProfile();
      setProfile(freshProfile ? { ...freshProfile, studentId: saved } : null);
      setStudentNumber("");
      setStage("resolvingProfile");
    } catch (error) {
      setGlobalError(errorMessage(error, "Couldn't save your student number."));
    } finally {
      setStudentIdBusy(false);
    }
  };

  const loadSchedule = useCallback(async (category: TimetableCategory, index: number, nextCalendar?: WeekCalendar) => {
    if (!service) return;
    const activeCalendar = nextCalendar ?? calendar;
    if (!activeCalendar?.weeks.length) return;
    const week = activeCalendar.weeks[index];
    if (!week) return;
    setWeekLoading(true);
    setGlobalError("");
    const wanted = activeCalendar.weeks.slice(Math.max(0, index - 1), Math.min(activeCalendar.weeks.length, index + 2));
    const cachedBefore = wanted.map((item) => service.cachedEvents(category.identity, item.number)?.fetchedAt ?? null);
    try {
      const loaded = await service.events(category, wanted);
      const byWeek: Record<number, TimetableEvent[]> = {};
      for (const item of wanted) {
        const firstDay = dublinDateKey(item.firstDay);
        const [year, month, date] = firstDay.split("-").map(Number);
        const start = Date.UTC(year, month - 1, date);
        byWeek[item.number] = loaded.filter((classItem) => {
          const classDate = dublinDateKey(effectiveStart(classItem));
          const [classYear, classMonth, classDay] = classDate.split("-").map(Number);
          const time = Date.UTC(classYear, classMonth - 1, classDay);
          return time >= start && time < start + 7 * 86400000;
        });
      }
      setEventsByWeek((current) => ({ ...current, ...byWeek }));
      const usedSavedData = wanted.some((item, offset) => {
        const before = cachedBefore[offset];
        return before !== null && service.cachedEvents(category.identity, item.number)?.fetchedAt === before;
      });
      setOfflineWarning(!navigator.onLine || usedSavedData);
      const weekEvents = byWeek[week.number] ?? [];
      if (weekEvents.length) {
        try {
          const tallies = await service.cancellationTallies(weekEvents.map(cancellationEventKey));
          setCancellations(Object.fromEntries(tallies.map((tally) => [tally.eventKey, service.cancellationStatus(tally)])));
          setReportsUnavailable(false);
        } catch {
          setReportsUnavailable(true);
        }
      }
    } catch (error) {
      const cached = wanted.map((item) => service.cachedEvents(category.identity, item.number));
      if (cached.some(Boolean)) {
        setEventsByWeek((current) => ({
          ...current,
          ...Object.fromEntries(wanted.flatMap((item, offset) => cached[offset]
            ? [[item.number, cached[offset]!.events]] : [])),
        }));
        setOfflineWarning(true);
        setGlobalError("You're offline. Showing the last saved timetable where available.");
      } else {
        setGlobalError(errorMessage(error, "Couldn't load this week's timetable."));
      }
    } finally {
      setWeekLoading(false);
    }
  }, [service, calendar]);

  const loadProfileSchedule = useCallback(async (resolved: Profile, index: number, nextCalendar?: WeekCalendar) => {
    if (!service) return;
    const activeCalendar = nextCalendar ?? calendar;
    const week = activeCalendar?.weeks[index];
    if (!activeCalendar || !week) return;
    setWeekLoading(true);
    const wanted = activeCalendar.weeks.slice(Math.max(0, index - 1), Math.min(activeCalendar.weeks.length, index + 2));
    try {
      const loaded = await service.profileEvents(resolved, wanted);
      const byWeek = Object.fromEntries(wanted.map((item) => [item.number,
        loaded.filter((event) => {
          const eventDate = dublinDateKey(effectiveStart(event));
          const weekDate = dublinDateKey(item.firstDay);
          const [eventYear, eventMonth, eventDay] = eventDate.split("-").map(Number);
          const [weekYear, weekMonth, weekDay] = weekDate.split("-").map(Number);
          const eventTime = Date.UTC(eventYear, eventMonth - 1, eventDay);
          const weekTime = Date.UTC(weekYear, weekMonth - 1, weekDay);
          return eventTime >= weekTime && eventTime < weekTime + 7 * 86400000;
        }),
      ]));
      setEventsByWeek((current) => ({ ...current, ...byWeek }));
      setOfflineWarning(!navigator.onLine);
      const events = byWeek[week.number] ?? [];
      if (events.length) {
        try {
          const tallies = await service.cancellationTallies(events.map(cancellationEventKey));
          setCancellations(Object.fromEntries(tallies.map((tally) => [tally.eventKey, service.cancellationStatus(tally)])));
          setReportsUnavailable(false);
        } catch {
          setReportsUnavailable(true);
        }
      }
    } catch (error) {
      setOfflineWarning(true);
      setGlobalError(errorMessage(error, "Couldn't load your profile timetable."));
    } finally {
      setWeekLoading(false);
    }
  }, [service, calendar]);

  const openProfileSchedule = useCallback(async (resolved: Profile) => {
    if (!service) return;
    if (user) persistOfflineProfile(user, resolved);
    setStudentProfile(resolved);
    setProgramme(null);
    setUsingProgramme(false);
    setPage("timetable");
    setStage("app");
    setGlobalError("");
    setEventsByWeek({});
    setWeekLoading(true);
    if (user) {
      try {
        const key = `dcu-timetable:groups:${user.id}:profile:${resolved.courseKey ?? ENGINEERING_COURSE}:${resolved.group}:${resolved.subgroup ?? ""}`;
        setHiddenGroups(new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]));
      } catch {
        setHiddenGroups(new Set());
      }
    }
    try {
      const weekCalendar = await service.weekCalendar();
      setCalendar(weekCalendar);
      setCalendarUnavailable(false);
      setCachedCalendarNotice(!navigator.onLine);
      const todayKey = dublinDateKey(new Date());
      const index = weekCalendar.weeks.findIndex((week) => {
        const weekStart = dublinDateKey(week.firstDay);
        const [year, month, day] = weekStart.split("-").map(Number);
        const weekEnd = new Date(Date.UTC(year, month - 1, day + 6, 12));
        return todayKey >= weekStart && todayKey <= dublinDateKey(weekEnd);
      });
      const selectedWeek = index < 0 ? 0 : index;
      setWeekIndex(selectedWeek);
      setDayIndex(Math.min(dublinWeekday(new Date()), 4));
      await loadProfileSchedule(resolved, selectedWeek, weekCalendar);
    } catch (error) {
      setCalendar(fallbackCalendar());
      setCalendarUnavailable(true);
      setWeekIndex(0);
      setDayIndex(Math.min(dublinWeekday(new Date()), 4));
      setEventsByWeek({});
      setOfflineWarning(true);
      setCachedCalendarNotice(true);
      setGlobalError(`Academic calendar unavailable offline. No saved calendar was found; reconnect and retry. ${errorMessage(error, "")}`.trim());
      setWeekLoading(false);
    }
  }, [service, loadProfileSchedule, user]);

  useEffect(() => {
    if (stage !== "resolvingProfile" || !service) return;
    let active = true;
    setGlobalError("");
    void (async () => {
      try {
        const resolved = await service.resolveProfile();
        if (!active) return;
        if (!resolved) {
          setProfileIssue("missingProfile");
          setStage("profileIssue");
          return;
        }
        setStudentProfile(resolved);
        setProfile(resolved);
        if (resolved.allocationStatus === "matched" && resolved.group) {
          setProfileIssue(null);
          await openProfileSchedule(resolved);
        } else if (resolved.allocationStatus === "ambiguous") {
          const options = await service.subgroups(resolved.courseKey ?? ENGINEERING_COURSE);
          if (!active) return;
          setSubgroupOptions(options);
          setStage("subgroup");
        } else {
          setProfileIssue(resolved.allocationStatus ?? "notListed");
          setStage("profileIssue");
        }
      } catch (error) {
        if (!active) return;
        setGlobalError(errorMessage(error, "Couldn't reach the server to resolve your class group."));
        setProfileIssue("lookupFailed");
        setStage("profileIssue");
      }
    })();
    return () => { active = false; };
  }, [stage, service, openProfileSchedule]);

  const resolveSubgroup = async (subgroup: string) => {
    if (!service || !studentProfile) return;
    setStudentIdBusy(true);
    setGlobalError("");
    try {
      const courseKey = studentProfile.courseKey ?? ENGINEERING_COURSE;
      const resolution = await service.resolveAllocation(courseKey, subgroup);
      if (resolution.status !== "matched") {
        setProfileIssue(resolution.status === "ambiguous" ? "notListed" : resolution.status);
        setStage("profileIssue");
        return;
      }
      const allocation = await service.allocation(courseKey, resolution.key);
      if (!allocation) {
        setProfileIssue("notListed");
        setStage("profileIssue");
        return;
      }
      const resolved: Profile = {
        ...studentProfile,
        group: allocation.group,
        subgroup: allocation.subgroup,
        workshop: allocation.workshop,
        drawing: allocation.drawing,
        allocationKey: resolution.key,
        rosterVersion: resolution.version,
        allocationStatus: "matched",
      };
      setProfile(resolved);
      setStudentProfile(resolved);
      setProfileIssue(null);
      await openProfileSchedule(resolved);
    } catch (error) {
      setGlobalError(errorMessage(error, "Couldn't resolve that subgroup. Try again when you are online."));
    } finally {
      setStudentIdBusy(false);
    }
  };

  const chooseProgramme = async (category: TimetableCategory) => {
    if (!service || !user) return;
    setProgramme(category);
    setUsingProgramme(true);
    try {
      setHiddenGroups(new Set(JSON.parse(localStorage.getItem(`dcu-timetable:groups:${user.id}:${category.identity}`) ?? "[]") as string[]));
    } catch {
      setHiddenGroups(new Set());
    }
    localStorage.setItem(`dcu-timetable:programme:${user.id}`, JSON.stringify(category));
    setProgrammeError("");
    setStage("app");
    setPage("timetable");
    try {
      const weekCalendar = await service.weekCalendar();
      setCalendar(weekCalendar);
      setCalendarUnavailable(false);
      setCachedCalendarNotice(!navigator.onLine);
      const todayKey = dublinDateKey(new Date());
      const todayIndex = weekCalendar.weeks.findIndex((item) => {
        const start = dublinDateKey(item.firstDay);
        const [year, month, day] = start.split("-").map(Number);
        const end = dublinDateKey(new Date(Date.UTC(year, month - 1, day + 6, 12)));
        return todayKey >= start && todayKey <= end;
      });
      const index = todayIndex < 0 ? 0 : todayIndex;
      setWeekIndex(index);
      setDayIndex(Math.min(dublinWeekday(new Date()), 4));
      void loadSchedule(category, index, weekCalendar);
    } catch (error) {
      setCalendar(fallbackCalendar());
      setCalendarUnavailable(true);
      setWeekIndex(0);
      setDayIndex(Math.min(dublinWeekday(new Date()), 4));
      setEventsByWeek({});
      setOfflineWarning(true);
      setCachedCalendarNotice(true);
      setGlobalError(`Academic calendar unavailable offline. No saved calendar was found; reconnect and retry. ${errorMessage(error, "")}`.trim());
    }
  };

  useEffect(() => {
    if (stage !== "programme" || !user || !profile?.studentId || !service) return;
    const stored = localStorage.getItem(`dcu-timetable:programme:${user.id}`);
    if (!stored) return;
    try {
      const saved = JSON.parse(stored) as TimetableCategory;
      if (!saved.identity || !saved.name) return;
      setProgramme(saved);
      setUsingProgramme(true);
      setHiddenGroups(new Set(JSON.parse(localStorage.getItem(`dcu-timetable:groups:${user.id}:${saved.identity}`) ?? "[]") as string[]));
      setStage("app");
      void (async () => {
        try {
          const weekCalendar = await service.weekCalendar();
          setCalendar(weekCalendar);
          setCalendarUnavailable(false);
          setCachedCalendarNotice(!navigator.onLine);
          const todayKey = dublinDateKey(new Date());
          const current = weekCalendar.weeks.findIndex((item) => {
            const start = dublinDateKey(item.firstDay);
            const [year, month, day] = start.split("-").map(Number);
            const end = dublinDateKey(new Date(Date.UTC(year, month - 1, day + 6, 12)));
            return todayKey >= start && todayKey <= end;
          });
          const index = current < 0 ? 0 : current;
          setWeekIndex(index);
          setDayIndex(Math.min(dublinWeekday(new Date()), 4));
          void loadSchedule(saved, index, weekCalendar);
        } catch (error) {
          setCalendar(fallbackCalendar());
          setCalendarUnavailable(true);
          setWeekIndex(0);
          setDayIndex(Math.min(dublinWeekday(new Date()), 4));
          setEventsByWeek({});
          setOfflineWarning(true);
          setCachedCalendarNotice(true);
          setGlobalError(`Academic calendar unavailable offline. No saved calendar was found; reconnect and retry. ${errorMessage(error, "")}`.trim());
        }
      })();
    } catch {
      localStorage.removeItem(`dcu-timetable:programme:${user.id}`);
    }
  }, [stage, user, profile, service, loadSchedule]);

  useEffect(() => {
    if (!user) return;
    const key = studentProfile && !usingProgramme
      ? `dcu-timetable:groups:${user.id}:profile:${studentProfile.courseKey ?? ENGINEERING_COURSE}:${studentProfile.group}:${studentProfile.subgroup ?? ""}`
      : programme ? `dcu-timetable:groups:${user.id}:${programme.identity}` : null;
    if (key) localStorage.setItem(key, JSON.stringify([...hiddenGroups]));
  }, [user, programme, studentProfile, usingProgramme, hiddenGroups]);

  const changeWeek = (delta: number) => {
    if (!calendar) return;
    const index = Math.min(Math.max(weekIndex + delta, 0), calendar.weeks.length - 1);
    setWeekIndex(index);
    setDayIndex(0);
    if (eventsByWeek[calendar.weeks[index]?.number]) return;
    if (!navigator.onLine) {
      setGlobalError("No saved timetable for that week. Reconnect to load it.");
      return;
    }
    if (studentProfile && !usingProgramme) void loadProfileSchedule(studentProfile, index);
    else if (programme) void loadSchedule(programme, index);
  };

  useEffect(() => {
    if (stage !== "programme" || !service) return;
    const query = programmeQuery.trim();
    if (query.length < 2) { setProgrammeResults([]); setProgrammeError(""); return; }
    let active = true;
    const timer = window.setTimeout(async () => {
      setProgrammeLoading(true);
      setProgrammeError("");
      try {
        const results = await service.searchProgrammes(query);
        if (active) setProgrammeResults(results);
      } catch (error) {
        if (active) {
          setProgrammeResults([]);
          setProgrammeError(errorMessage(error, "Couldn't search programmes right now."));
        }
      } finally {
        if (active) setProgrammeLoading(false);
      }
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [programmeQuery, stage, service]);

  const currentWeek = calendar?.weeks[weekIndex] ?? null;
  const rawWeekEvents = currentWeek ? eventsByWeek[currentWeek.number] ?? [] : [];
  const groupOptions = useMemo(() => {
    const groups = new Map<string, { key: string; label: string; module: string; count: number }>();
    Object.values(eventsByWeek).flat().forEach((event) => {
      const key = event.groupKey;
      const prior = groups.get(key);
      groups.set(key, {
        key,
        label: event.groupLabel,
        module: event.moduleCode ?? "Classes",
        count: (prior?.count ?? 0) + 1,
      });
    });
    return [...groups.values()].sort((a, b) => a.module.localeCompare(b.module) || a.label.localeCompare(b.label));
  }, [eventsByWeek]);
  const visibleWeekEvents = useMemo(() => rawWeekEvents.filter((event) => !hiddenGroups.has(event.groupKey)), [rawWeekEvents, hiddenGroups]);
  const clashes = useMemo(() => getOverlaps(visibleWeekEvents), [visibleWeekEvents]);
  const currentDay = currentWeek ? dayForWeek(currentWeek, dayIndex) : new Date();
  const dayEvents = visibleWeekEvents.filter((event) => sameLocalDay(effectiveStart(event), currentDay));
  const currentEvents = viewMode === "day" ? dayEvents : visibleWeekEvents;
  const sortedEvents = [...currentEvents].sort((a, b) => Date.parse(effectiveStart(a)) - Date.parse(effectiveStart(b)));
  const nextEvent = visibleWeekEvents.filter((event) => event.verdict?.state !== "cancelled")
    .find((event) => Date.parse(effectiveEnd(event)) > Date.now());
  const moduleKeys = [...new Set(Object.values(eventsByWeek).flat().map((event) => event.moduleCode).filter((value): value is string => Boolean(value)))];

  const loadDeadlines = useCallback(async () => {
    if (!service || !moduleKeys.length) { setDeadlines([]); return; }
    if (!navigator.onLine) {
      setDeadlinesUnavailable(true);
      return;
    }
    try {
      const rows = await service.deadlines(moduleKeys);
      setDeadlines(rows);
      const standings = await service.deadlineStandings(rows.map((deadline) => deadline.id));
      setDeadlineStandings(standings);
      setDeadlinesUnavailable(false);
    } catch (error) {
      setDeadlinesUnavailable(true);
      setGlobalError(errorMessage(error, "Couldn't load deadlines."));
    }
  }, [service, moduleKeys.join("|"), online]);

  useEffect(() => { void loadDeadlines(); }, [loadDeadlines]);

  useEffect(() => {
    if (page !== "account" || !service || !navigator.onLine) return;
    void service.hiddenAuthorCount().then(setHiddenAuthorCount).catch((error: unknown) => {
      setGlobalError(errorMessage(error, "Couldn't load hidden deadline authors."));
    });
  }, [page, service, online]);

  const saveDeadline = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!service || !user || !deadlineTitle.trim() || !deadlineDue || !deadlineModule) return;
    setDeadlineBusy(true);
    try {
      await service.submitDeadline({
        moduleKey: deadlineModule,
        atGroupKey: deadlineGroup || null,
        title: deadlineTitle,
        due: dublinInstant(deadlineDue),
        kind: deadlineKind,
        submitterId: user.id,
      });
      setDeadlineModal(false);
      setDeadlineTitle("");
      setDeadlineGroup("");
      await loadDeadlines();
      notify("Deadline shared with your class.");
    } catch (error) {
      setGlobalError(errorMessage(error, "Couldn't save that deadline."));
    } finally {
      setDeadlineBusy(false);
    }
  };

  const removeDeadline = async (deadline: ModuleDeadline) => {
    if (!service) return;
    try {
      await service.withdrawDeadline(deadline.id);
      await loadDeadlines();
      notify("Deadline removed.");
    } catch (error) {
      setGlobalError(errorMessage(error, "Couldn't remove that deadline."));
    }
  };

  const toggleDeadlineConfirmation = async (deadline: ModuleDeadline) => {
    if (!service || !user) return;
    const standing = deadlineStandings[deadline.id];
    try {
      if (standing?.confirmedByMe) await service.unconfirmDeadline(deadline.id, user.id);
      else await service.confirmDeadline(deadline.id, user.id);
      await loadDeadlines();
    } catch (error) {
      setGlobalError(errorMessage(error, "Couldn't update that confirmation."));
    }
  };

  const moderateDeadline = async (deadline: ModuleDeadline, action: "report" | "hide") => {
    if (!service || deadline.isMine) return;
    try {
      if (action === "report") await service.reportDeadline(deadline.id, deadlineReportReason);
      else await service.hideDeadlineAuthor(deadline.id);
      await loadDeadlines();
      if (action === "hide") setHiddenAuthorCount(await service.hiddenAuthorCount());
      notify(action === "report" ? "Deadline report submitted." : "Deadlines from this author are hidden.");
    } catch (error) {
      setGlobalError(errorMessage(error, action === "report" ? "Couldn't report that deadline." : "Couldn't hide that author."));
    }
  };

  const clearHiddenAuthors = async () => {
    if (!service) return;
    try {
      await service.unhideAllAuthors();
      setHiddenAuthorCount(0);
      await loadDeadlines();
      notify("Hidden deadline authors restored.");
    } catch (error) {
      setGlobalError(errorMessage(error, "Couldn't restore hidden authors."));
    }
  };

  const copyPublicId = async () => {
    if (!profile?.pi) return;
    try {
      await navigator.clipboard.writeText(profile.pi);
      setPiCopied(true);
      window.setTimeout(() => setPiCopied(false), 1800);
    } catch {
      setGlobalError("Clipboard access isn't available. Select and copy your public ID manually.");
    }
  };

  const openExternal = async (url: string) => {
    try {
      if (isTauri()) await openUrl(url);
      else window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setGlobalError(errorMessage(error, "Couldn't open that page."));
    }
  };

  const refreshEventVerdict = async (event: TimetableEvent) => {
    if (!service) return;
    const key = cancellationEventKey(event);
    const [verdict] = await service.getVerdicts([key]);
    const updatedVerdict = verdict ?? null;
    const patchEvent = (item: TimetableEvent): TimetableEvent => cancellationEventKey(item) === key
      ? { ...item, verdict: updatedVerdict }
      : item;
    setEventsByWeek((current) => Object.fromEntries(Object.entries(current).map(([week, items]) => [week, items.map(patchEvent)])));
    setSelectedEvent((current) => current ? patchEvent(current) : current);
  };

  const decideClass = async (event: TimetableEvent, state: EventVerdict["state"] | null) => {
    if (!service || !event.moduleCode || !maySetVerdict(profile)) return;
    setDetailBusy(true);
    try {
      if (state) {
        await service.setVerdict(cancellationEventKey(event), event.moduleCode, state, {
          note: trustedVerdictNote.trim() || undefined,
          roomOverride: trustedVerdictRoom.trim() || undefined,
          startOverride: trustedVerdictStart ? dublinInstant(trustedVerdictStart).toISOString() : undefined,
          label: profile?.displayName ?? undefined,
        });
      } else {
        await service.clearVerdict(cancellationEventKey(event));
      }
      await refreshEventVerdict(event);
      setTrustedVerdictNote("");
      setTrustedVerdictRoom("");
      setTrustedVerdictStart("");
      notify(state ? "Class decision updated for everyone." : "Class decision cleared.");
    } catch (error) {
      setGlobalError(errorMessage(error, "Couldn't update the class decision."));
    } finally {
      setDetailBusy(false);
    }
  };

  const reportClass = async (event: TimetableEvent, stance: ReportStance | null) => {
    if (!service || !user || hasActiveVerdict(event)) return;
    setDetailBusy(true);
    const key = cancellationEventKey(event);
    try {
      if (stance) await service.setCancellationStance(key, user.id, stance);
      else await service.withdrawCancellation(key, user.id);
      const [tally] = await service.cancellationTallies([key]);
      setCancellations((current) => ({ ...current, [key]: service.cancellationStatus(tally) }));
      setReportsUnavailable(false);
      notify(stance ? "Your class report was recorded." : "Your report was withdrawn.");
    } catch (error) {
      setReportsUnavailable(true);
      setGlobalError(errorMessage(error, "Couldn't update the class report."));
    } finally {
      setDetailBusy(false);
    }
  };

  const signOut = async () => {
    if (!service) return;
    try {
      await service.signOut();
      clearOfflineProfile(user?.id ?? activeUserId.current);
      activeUserId.current = null;
      setUser(null);
      setProfile(null);
      setStudentProfile(null);
      setProgramme(null);
      setCalendar(null);
      setEventsByWeek({});
      setDeadlines([]);
      setCancellations({});
      setDeadlineStandings({});
      setStage("auth");
      setPage("timetable");
      setAuthPassword("");
    } catch (error) {
      setGlobalError(errorMessage(error, "Couldn't sign out."));
    }
  };

  const deleteAccount = async () => {
    if (!service) return;
    try {
      await service.deleteAccount();
      clearOfflineProfile(user?.id ?? activeUserId.current);
      activeUserId.current = null;
      await signOut();
    } catch (error) {
      setGlobalError(errorMessage(error, "Couldn't delete your account."));
    }
  };

  const changeProgramme = () => {
    if (user) localStorage.removeItem(`dcu-timetable:programme:${user.id}`);
    setProgramme(null);
    setCalendar(null);
    setEventsByWeek({});
    setProgrammeQuery("");
    setUsingProgramme(true);
    setStage("programme");
  };

  const retryCalendar = async () => {
    if (!service) return;
    setGlobalError("");
    setWeekLoading(true);
    try {
      const fresh = await service.weekCalendar();
      setCalendar(fresh);
      setCalendarUnavailable(false);
      setCachedCalendarNotice(!navigator.onLine);
      setOfflineWarning(!navigator.onLine);
      const todayKey = dublinDateKey(new Date());
      const index = fresh.weeks.findIndex((week) => {
        const start = dublinDateKey(week.firstDay);
        const [year, month, day] = start.split("-").map(Number);
        const end = dublinDateKey(new Date(Date.UTC(year, month - 1, day + 6, 12)));
        return todayKey >= start && todayKey <= end;
      });
      const selected = index < 0 ? 0 : index;
      setWeekIndex(selected);
      setDayIndex(Math.min(dublinWeekday(new Date()), 4));
      if (studentProfile && !usingProgramme) await loadProfileSchedule(studentProfile, selected, fresh);
      else if (programme) await loadSchedule(programme, selected, fresh);
      else setWeekLoading(false);
    } catch (error) {
      setWeekLoading(false);
      setGlobalError(`Academic calendar unavailable. ${errorMessage(error, "Reconnect and retry.")}`);
      setCalendarUnavailable(true);
    }
  };

  const goToToday = () => {
    if (!calendar) return;
    const todayKey = dublinDateKey(new Date());
    const found = calendar.weeks.findIndex((week) => {
      const start = dublinDateKey(week.firstDay);
      const [year, month, day] = start.split("-").map(Number);
      const end = dublinDateKey(new Date(Date.UTC(year, month - 1, day + 6, 12)));
      return todayKey >= start && todayKey <= end;
    });
    const selected = found < 0 ? weekIndex : found;
    setWeekIndex(selected);
    setDayIndex(Math.min(dublinWeekday(new Date()), 4));
    const weekNumber = calendar.weeks[selected]?.number;
    if (weekNumber == null || eventsByWeek[weekNumber]) return;
    if (!navigator.onLine) {
      setGlobalError("No saved timetable for today. Reconnect to load it.");
      return;
    }
    if (studentProfile && !usingProgramme) void loadProfileSchedule(studentProfile, selected);
    else if (programme) void loadSchedule(programme, selected);
  };

  const toggleGroup = (key: string) => {
    setHiddenGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleSkippedAttendance = (event: TimetableEvent) => {
    const key = cancellationEventKey(event);
    setSkippedEventKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const navItems: Array<{ id: Page; title: string; icon: string }> = [
    { id: "timetable", title: "Timetable", icon: "▦" },
    { id: "groups", title: "My groups", icon: "♧" },
    { id: "labs", title: "Engineering Labs", icon: "⚗" },
    { id: "deadlines", title: "Deadlines", icon: "✓" },
    { id: "account", title: "Account", icon: "◉" },
  ];
  const name = user ? displayName(user, profile) : "Student";
  const allocationIssueMessage: Record<Exclude<NonNullable<typeof profileIssue>, "matched">, string> = {
    missingProfile: "Your account profile could not be loaded. Sign out and back in, or try again when connected.",
    ambiguous: "More than one student on the class list matches your account. Choose your subgroup so we can show your own group and lab rotation.",
    notListed: "Your account name isn't on the EEG1 class list, so your allocated group can't be confirmed. You can browse the public timetable while this is checked.",
    conflict: "Your details don't match the class list cleanly. The allocation needs a person to check; use a public timetable in the meantime.",
    noRoster: "No EEG1 class list is available, so your lab group can't be looked up yet. You can browse the public timetable meanwhile.",
    lookupFailed: "We couldn't reach the server to look up your group. Check your connection and retry.",
  };

  if (stage === "checking") return <main className="loading-screen"><div><div className="loading-indicator" />Opening your timetable…</div></main>;

  if (stage === "auth") return <div className="auth-screen">
    <section className="auth-story">
      <Brand />
      <div className="auth-message">
        <p className="eyebrow">Your campus, organised</p>
        <h1>A clearer week starts here.</h1>
        <p>Keep classes, group sessions and deadlines together. Know what is on before you head in.</p>
        <div className="auth-perks">
          <div className="auth-perk"><span className="perk-check">✓</span> Your timetable, organised by day</div>
          <div className="auth-perk"><span className="perk-check">✓</span> Class group and clash alerts</div>
          <div className="auth-perk"><span className="perk-check">✓</span> Deadlines shared with classmates</div>
        </div>
      </div>
      <div className="auth-foot">A student companion for Dublin City University.</div>
    </section>
    <section className="auth-panel"><form className="auth-form" onSubmit={handleAuth}>
      <p className="eyebrow">DCU student access</p>
      <h2>{authMode === "signin" ? "Welcome back" : "Create your account"}</h2>
      <p>{authMode === "signin" ? "Sign in to pick up where you left off." : "Use your DCU email address to get started."}</p>
      {!service && <div className="form-error">Student accounts are not connected yet. Add the Supabase URL and public anon key in <code>desktop/.env.local</code>.</div>}
      {globalError && <div className="form-error">{globalError}</div>}
      {authNotice && <div className="auth-success">{authNotice}</div>}
      <div className="auth-tabs" role="tablist" aria-label="Account actions">
        <button type="button" role="tab" aria-selected={authMode === "signin"} className={authMode === "signin" ? "selected" : ""} onClick={() => { setAuthMode("signin"); setAuthError(""); }}>Sign in</button>
        <button type="button" role="tab" aria-selected={authMode === "signup"} className={authMode === "signup" ? "selected" : ""} onClick={() => { setAuthMode("signup"); setAuthError(""); setAuthNotice(""); }}>Create account</button>
      </div>
      <div className="form-grid">
        <div className="form-field"><label htmlFor="auth-email">DCU email</label><input id="auth-email" type="email" autoComplete="email" required placeholder="you@dcu.ie" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} /></div>
        <div className="form-field"><label htmlFor="auth-password">Password</label><input id="auth-password" type="password" autoComplete={authMode === "signin" ? "current-password" : "new-password"} required minLength={8} placeholder={authMode === "signup" ? "8+ characters, upper/lowercase and a number" : "Your password"} value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} />{authMode === "signup" && <small className="form-hint">At least 8 characters, with a capital, a lower-case letter and a number.</small>}</div>
        {authMode === "signup" && <div className="form-field"><label htmlFor="auth-confirm">Confirm password</label><input id="auth-confirm" type="password" autoComplete="new-password" required minLength={8} placeholder="Type it again" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></div>}
      </div>
      {authError && <p className="form-error" role="alert">{authError}</p>}
      <button className="button primary" type="submit" disabled={authBusy}>{authBusy ? "Please wait…" : authMode === "signin" ? "Sign in" : "Create account"}<span aria-hidden="true">→</span></button>
      {authMode === "signin" && <button type="button" className="button ghost" style={{ width: "100%", marginTop: 8 }} onClick={() => void requestPasswordReset()}>Forgot password?</button>}
      {authNotice.includes("confirmation link") && <button type="button" className="button ghost" style={{ width: "100%", marginTop: 8 }} onClick={() => void resendConfirmation()}>Resend confirmation email</button>}
      {user && <button type="button" className="button ghost" style={{ width: "100%", marginTop: 8 }} onClick={() => void signOut()}>Sign out</button>}
      {authMode === "signup" && <p className="auth-terms">Creating an account means you agree to use class reports and shared deadlines respectfully. Account access is subject to DCU timetable app terms.</p>}
    </form></section>
  </div>;

  if (stage === "studentId") return <div className="auth-screen">
    <section className="auth-story"><Brand /><div className="auth-message"><p className="eyebrow">One more step</p><h1>Make it yours.</h1><p>Enter the student number shown on your DCU student card. No camera or photo is needed.</p></div><div className="auth-foot">Your student number is stored securely with your account.</div></section>
    <section className="auth-panel"><form className="auth-form" onSubmit={handleStudentNumber}>
      <p className="eyebrow">Student profile</p><h2>Enter your student number</h2><p>This helps connect your student account. You can enter it manually; we never ask to access your camera.</p>
      <div className="student-step"><div className="form-field"><label htmlFor="student-number">Student number</label><input id="student-number" autoComplete="off" autoCapitalize="characters" placeholder="A00000000" value={studentNumber} onChange={(event) => setStudentNumber(event.target.value.toUpperCase())} required pattern="[A-Za-z][0-9]{8}" title="One letter followed by eight digits" /><small className="form-hint">One letter followed by eight digits, for example A00000000.</small></div>
        {globalError && <p className="form-error" role="alert">{globalError}</p>}
        <button className="button primary" type="submit" disabled={studentIdBusy}>{studentIdBusy ? "Saving…" : "Continue"}<span aria-hidden="true">→</span></button>
      </div>
      <button type="button" className="button ghost" style={{ marginTop: 12, width: "100%" }} onClick={() => void signOut()}>Sign out</button>
    </form></section>
  </div>;

  if (stage === "resolvingProfile") return <main className="loading-screen"><div><div className="loading-indicator" />Checking the class list and finding your group…</div></main>;

  if (stage === "subgroup") return <div className="auth-screen">
    <section className="auth-story"><Brand /><div className="auth-message"><p className="eyebrow">Class allocation</p><h1>One quick check.</h1><p>Several students match your name. Choose your subgroup to match your personal group and weekly lab schedule.</p></div><div className="auth-foot">Your classmates' personal details stay on the server.</div></section>
    <section className="auth-panel"><div className="auth-form"><p className="eyebrow">Year 1 Engineering</p><h2>Which subgroup are you in?</h2><p>We found more than one match on the class list. Your subgroup distinguishes your allocation.</p>{globalError && <p className="form-error" role="alert">{globalError}</p>}<div className="group-chips" style={{ marginTop: 18 }}>{subgroupOptions.map((subgroup) => <button key={subgroup} type="button" className="button" disabled={studentIdBusy} onClick={() => void resolveSubgroup(subgroup)}>{studentIdBusy ? "Checking…" : subgroup}<span aria-hidden="true">→</span></button>)}</div>{!subgroupOptions.length && <div className="empty-day">No subgroup options were provided for this roster. Try again or browse the public timetable.</div>}<button type="button" className="button ghost" style={{ width: "100%", marginTop: 14 }} onClick={() => { setProfileIssue("ambiguous"); setStage("profileIssue"); }}>Other options</button></div></section>
  </div>;

  if (stage === "profileIssue") return <div className="auth-screen">
    <section className="auth-story"><Brand /><div className="auth-message"><p className="eyebrow">Student profile</p><h1>Let's find your timetable.</h1><p>We check your account against the supported course allocation before building your personal schedule.</p></div><div className="auth-foot">Year 1 Engineering group and rotation support.</div></section>
    <section className="auth-panel"><div className="auth-form"><p className="eyebrow">Allocation lookup</p><h2>{profileIssue === "lookupFailed" ? "Couldn't reach the server" : "Group not resolved yet"}</h2><p>{profileIssue && profileIssue !== "matched" ? allocationIssueMessage[profileIssue] : allocationIssueMessage.lookupFailed}</p>{globalError && <p className="form-error" role="alert">{globalError}</p>}{profileIssue === "lookupFailed" && <button className="button" style={{ width: "100%", marginBottom: 9 }} onClick={() => setStage("resolvingProfile")}>Try again</button>}<button className="button primary" style={{ width: "100%" }} onClick={() => { setProgrammeQuery(""); setUsingProgramme(true); setStage("programme"); }}>Browse public timetables <span aria-hidden="true">→</span></button><button type="button" className="button ghost" style={{ width: "100%", marginTop: 9 }} onClick={() => void signOut()}>Sign out</button></div></section>
  </div>;

  if (stage === "programme") return <div className="auth-screen">
    <section className="auth-story"><Brand /><div className="auth-message"><p className="eyebrow">Find your course</p><h1>Start with your programme.</h1><p>Search the DCU timetable and choose your programme of study. You can adjust your groups at any time.</p></div><div className="auth-foot">Timetable data comes from DCU's public schedule.</div></section>
    <section className="auth-panel"><div className="auth-form">
      <p className="eyebrow">Welcome, {name}</p><h2>Choose your programme</h2><p>Search by programme name or code, then select your course.</p>
      <div className="form-field"><label htmlFor="programme-search">Programme name or code</label><input id="programme-search" autoFocus type="search" placeholder="Try Computer Science or CASE" value={programmeQuery} onChange={(event) => setProgrammeQuery(event.target.value)} /></div>
      {programmeLoading && <p className="subheading" style={{ marginTop: 14 }}>Searching programmes…</p>}
      {programmeError && <p className="form-error" style={{ marginTop: 14 }}>{programmeError}</p>}
      <div style={{ display: "grid", gap: 8, marginTop: 14, maxHeight: "48vh", overflow: "auto" }}>
        {programmeResults.map((item) => <button key={item.identity} type="button" className="button" style={{ justifyContent: "space-between", textAlign: "left", minHeight: 56, padding: "10px 13px" }} onClick={() => void chooseProgramme(item)}><span><strong style={{ display: "block", color: "var(--ink)" }}>{item.name.split(" ")[0]}</strong><small style={{ color: "var(--muted)" }}>{item.name}</small></span><span aria-hidden="true">→</span></button>)}
        {!programmeLoading && programmeQuery.trim().length >= 2 && !programmeResults.length && !programmeError && <div className="empty-day">No programmes found. Try a different name or code.</div>}
        {programmeQuery.trim().length < 2 && <div className="empty-day">Enter at least two characters to search.</div>}
      </div>
      {globalError && <p className="form-error" style={{ marginTop: 14 }}>{globalError}</p>}
      <button type="button" className="button ghost" style={{ marginTop: 15, width: "100%" }} onClick={() => void signOut()}>Sign out</button>
    </div></section>
  </div>;

  const testsSoon = deadlines.filter((item) => isSatInClass(item.kind)).length;
  const today = new Date();
  const hourInDublin = Number(new Intl.DateTimeFormat("en-IE", { timeZone: TIME_ZONE, hour: "2-digit", hourCycle: "h23" }).format(today));
  const scheduleTitle = usingProgramme ? programme?.name ?? "DCU programme" : "Year 1 Engineering";
  const labRotationEvents = [...new Map(Object.values(eventsByWeek).flat()
    .filter((event) => event.id.startsWith("rotation-")).map((event) => [event.id, event])).values()]
    .sort((left, right) => Date.parse(left.start) - Date.parse(right.start));
  const nav = <div className="nav-list">{navItems.map((item) => <button key={item.id} type="button" className={`nav-item ${page === item.id ? "active" : ""}`} onClick={() => setPage(item.id)}><Icon>{item.icon}</Icon>{item.title}</button>)}</div>;

  return <div className="app-shell" data-theme={resolvedAppearance}>
    <aside className="sidebar"><Brand /><p className="side-label">Workspace</p>{nav}<div className="side-spacer" />
      <div className="offline-note"><span className="online-dot" style={{ background: online ? undefined : "#efa94b" }} />{online ? "Connected" : "Offline · saved timetable"}</div>
      <div className="profile-mini"><div className="avatar">{initials(name)}</div><div className="profile-copy"><strong>{name}</strong><small>{studentProfile?.group ? `Engineering · ${studentProfile.group}` : programme?.name.split(" ")[0] ?? user?.email}</small></div><button className="icon-button" aria-label="Open account" onClick={() => setPage("account")}>•••</button></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="crumb">Student workspace&nbsp; / &nbsp;<b>{page === "timetable" ? "Timetable" : page === "groups" ? "My groups" : page === "labs" ? "Engineering Labs" : page === "deadlines" ? "Deadlines" : "Account"}</b></div><div className="mobile-brand"><span className="brand-mark">D</span>DCU timetable</div><div className="top-actions"><span className="week-caption">{currentWeek ? `Week ${currentWeek.label}` : "Your student space"}</span><button className="top-action" onClick={() => setPage("account")}><span className="avatar" style={{ width: 25, height: 25, flexBasis: 25, fontSize: 9 }}>{initials(name)}</span><span className="hide-mobile">{name}</span></button></div></header>
      <div className="content">
        {globalError && <div className="status-banner" role="status"><span>ⓘ</span>{globalError}{cachedCalendarNotice && <button className="button small" style={{ marginLeft: "auto" }} onClick={() => void retryCalendar()}>Retry</button>}<button className="icon-button" style={{ marginLeft: cachedCalendarNotice ? 4 : "auto", color: "inherit" }} onClick={() => setGlobalError("")} aria-label="Dismiss">×</button></div>}
        {(offlineWarning || !online || cachedCalendarNotice || reportsUnavailable || deadlinesUnavailable) && <div className="status-banner"><span>⌁</span>{!online ? "You're offline. Timetable entries may be from saved data; shared reports and deadlines are unavailable." : calendarUnavailable ? "Calendar unavailable. Reconnect to load the academic schedule." : reportsUnavailable || deadlinesUnavailable ? `Public timetable is available, but ${reportsUnavailable && deadlinesUnavailable ? "reports and shared deadlines are" : reportsUnavailable ? "class reports are" : "shared deadlines are"} currently unavailable.` : "Showing saved timetable data where available."}</div>}
        {page === "timetable" && <>
          <div className="page-heading"><div><p className="eyebrow">{studentProfile?.group ? `Engineering · Group ${studentProfile.group}` : scheduleTitle.split(" ")[0]}</p><h1>Good {hourInDublin < 12 ? "morning" : hourInDublin < 18 ? "afternoon" : "evening"}, {name.split(" ")[0]}.</h1><p className="subheading">{studentProfile?.group ? `${scheduleTitle} · ${studentProfile.group}${studentProfile.subgroup ? ` · ${studentProfile.subgroup}` : ""}` : scheduleTitle}</p></div><div className="heading-actions"><button className="button" onClick={changeProgramme}>{usingProgramme ? "Change programme" : "Browse programmes"}</button><button className="button primary" onClick={() => setPage("groups")}>Groups <span aria-hidden="true">→</span></button></div></div>
          <div className="dashboard-grid">
            <section className="panel schedule-panel">
              <div className="panel-header"><div><h2>Class schedule</h2><p className="panel-subtitle">{studentProfile?.group ? `${scheduleTitle} · group ${studentProfile.group}` : scheduleTitle}</p></div><div className="view-switch"><button className={viewMode === "day" ? "selected" : ""} onClick={() => setViewMode("day")}>Day</button><button className={viewMode === "week" ? "selected" : ""} onClick={() => setViewMode("week")}>Week</button></div></div>
              <div className="week-toolbar"><div className="week-buttons"><button className="square-button" aria-label="Previous week" disabled={!calendar || weekIndex === 0 || calendar.weeks.length === 1} onClick={() => changeWeek(-1)}>‹</button><strong>{currentWeek ? `Week ${currentWeek.label}` : "Loading calendar"}</strong><button className="square-button" aria-label="Next week" disabled={!calendar || weekIndex >= calendar.weeks.length - 1 || calendar.weeks.length === 1} onClick={() => changeWeek(1)}>›</button></div><button className="button small" onClick={goToToday}>Today</button></div>
              {viewMode === "day" && <div className="day-tabs">{weekdayOptions.map((day, index) => { const date = currentWeek ? dayForWeek(currentWeek, index) : new Date(); return <button key={day.name} className={`day-tab ${dayIndex === index ? "active" : ""}`} onClick={() => setDayIndex(index)}>{day.name}<b>{new Intl.DateTimeFormat("en-IE", { timeZone: TIME_ZONE, day: "numeric" }).format(date)}</b></button>; })}</div>}
              <div className="class-list">
                {weekLoading && !rawWeekEvents.length && <div className="empty-day"><div className="loading-indicator" />Loading your classes…</div>}
                {!weekLoading && sortedEvents.map((event, index) => {
                  const eventKey = cancellationEventKey(event);
                  const report = cancellations[eventKey];
                  const hasClash = clashes.has(event.id);
                  const firstOfDay = viewMode === "week" && (index === 0 || !sameLocalDay(effectiveStart(sortedEvents[index - 1]), new Date(effectiveStart(event))));
                  const effectiveFlagged = event.verdict ? event.verdict.state === "cancelled" : Boolean(report?.isFlagged);
                  const skipped = skippedEventKeys.has(eventKey);
                  const dueToday = deadlines.filter((deadline) => deadline.moduleKey === (event.moduleCode ?? event.activity.raw)
                    && (!deadline.atGroupKey || deadline.atGroupKey === event.groupKey)
                    && dublinDateKey(deadline.due) === dublinDateKey(effectiveStart(event)));
                  const dueKind = dueToday.some((deadline) => isSatInClass(deadline.kind)) ? "test" : dueToday.length ? "deadline" : "";
                  return <div key={`${event.id}-${index}`}>{firstOfDay && <div className="week-day-heading">{new Intl.DateTimeFormat("en-IE", { timeZone: TIME_ZONE, weekday: "long", month: "short", day: "numeric" }).format(new Date(effectiveStart(event)))}</div>}<button type="button" className={`class-row ${hasClash ? "clash" : ""} ${dueKind && !effectiveFlagged ? dueKind : ""} ${effectiveFlagged ? "cancelled" : ""} ${skipped ? "skipped" : ""}`} onClick={() => { setTrustedVerdictNote(event.verdict?.note ?? ""); setTrustedVerdictRoom(event.verdict?.roomOverride ?? ""); setTrustedVerdictStart(dublinInputValue(event.verdict?.startOverride)); setSelectedEvent(event); }}>
                    <span className="class-time">{clock(effectiveStart(event))}<small>{clock(effectiveEnd(event))}</small></span><span className={`class-bar ${event.activity.kind === "P" ? "mint" : event.activity.kind === "T" ? "orange" : ""}`} />
                    <span className="class-info"><span className="class-title">{event.title}{skipped && <span className="tag">SKIPPING</span>}{event.verdict?.state === "cancelled" ? <span className="tag red">CANCELLED</span> : event.verdict?.state === "moved" ? <span className="tag warn">MOVED</span> : event.verdict?.state === "running" ? <span className="tag green">CONFIRMED ON</span> : effectiveFlagged && <span className="tag red">CANCELLED?</span>}</span><span className="class-meta"><span>{event.moduleCode ?? event.activity.raw}</span><span>⌖ {event.verdict?.roomOverride ?? (event.locations.join(", ") || "Location TBC")}</span><span>♧ {event.groupLabel}</span></span></span>
                    <span className="class-tags">{hasClash && <span className="tag warn">⚠ Clash</span>}{dueKind && !effectiveFlagged && <span className={`tag ${dueKind === "test" ? "red" : "blue"}`} title={dueToday.map((deadline) => deadline.title).join(", ")}>{dueKind === "test" ? "TEST TODAY" : "DUE TODAY"}</span>}{!hasActiveVerdict(event) && report && report.reportCount > 0 && !report.isFlagged && <span className="tag">{report.reportCount} report{report.reportCount === 1 ? "" : "s"}</span>}</span>
                  </button></div>;
                })}
                {!weekLoading && !sortedEvents.length && <div className="empty-day"><div className="empty-icon">{calendarUnavailable ? "⌁" : "▦"}</div><strong>{calendarUnavailable ? "Timetable calendar unavailable" : viewMode === "day" ? "No classes on this day" : "No classes this week"}</strong><p style={{ margin: "7px 0 0" }}>{calendarUnavailable ? "Reconnect to load the academic calendar. We won't present an offline fallback as an empty week." : viewMode === "day" ? "Try another day or move to a different week." : "Your selected groups have no scheduled classes."}</p>{calendarUnavailable && <button className="button small" style={{ marginTop: 12 }} onClick={() => void retryCalendar()}>Retry calendar</button>}</div>}
              </div>
            </section>
            <aside className="right-column">
              <div className="stats-grid"><div className="panel stat-card"><span className="stat-label">Classes this week</span><div className="stat-number">{visibleWeekEvents.length}</div><span className="stat-foot">Across your selected groups</span></div><div className="panel stat-card"><span className="stat-label">Classes in clash</span><div className="stat-number" style={{ color: clashes.size ? "var(--orange)" : "var(--mint)" }}>{clashes.size}</div><span className="stat-foot">After group filtering</span></div></div>
              <section className="panel next-class"><div className="panel-header"><h2>Next class</h2><span className="tag blue">UP NEXT</span></div><div className="next-class-body">{nextEvent ? <><div className="next-time"><strong>{sameLocalDay(effectiveStart(nextEvent), today) ? "Today" : monthDay(effectiveStart(nextEvent))} · {clock(effectiveStart(nextEvent))}</strong><span>{Math.max(0, Math.ceil((Date.parse(effectiveStart(nextEvent)) - Date.now()) / 60000))} min</span></div><div className="next-title">{nextEvent.title}{nextEvent.verdict?.state === "cancelled" && <span className="tag red"> CANCELLED</span>}{nextEvent.verdict?.state === "moved" && <span className="tag warn"> MOVED</span>}</div><p className="next-module">{nextEvent.moduleCode} · {nextEvent.groupLabel}</p><div className="next-details"><div className="next-detail">⌖ <b>{nextEvent.verdict?.roomOverride ?? (nextEvent.locations.join(", ") || "Location TBC")}</b></div><div className="next-detail">◷ <b>{clock(effectiveStart(nextEvent))} – {clock(effectiveEnd(nextEvent))}</b></div></div></> : <div className="empty-day" style={{ padding: "21px 5px" }}>No upcoming classes in this week.</div>}</div></section>
              <section className="panel deadlines-card"><div className="panel-header"><h2>Upcoming deadlines</h2><button className="button small" onClick={() => setPage("deadlines")}>View all</button></div><div className="deadline-list">{deadlines.slice(0, 3).map((deadline) => <div className="deadline-item" key={deadline.id}><span className={`deadline-kind ${isSatInClass(deadline.kind) ? "test" : ""}`}>{isSatInClass(deadline.kind) ? "▤" : "▣"}</span><span className="deadline-copy"><strong>{deadline.title}</strong><small>{deadline.moduleKey} · {monthDay(deadline.due)}</small></span><span className="deadline-count">{countdown(deadline.due)}</span></div>)}{!deadlines.length && <div className="empty-day" style={{ padding: "21px 5px" }}>Nothing due soon.</div>}</div></section>
            </aside>
          </div>
        </>}

        {page === "groups" && <>
          <div className="page-heading"><div><p className="eyebrow">Personalise your schedule</p><h1>My groups</h1><p className="subheading">Turn off streams you don't attend. Clash detection uses the groups left on.</p></div><button className="button" onClick={() => setHiddenGroups(new Set())}>Reset filters</button></div>
          <section className="panel"><div className="panel-header"><div><h2>{scheduleTitle}</h2><p className="panel-subtitle">{groupOptions.length} class groups found in the loaded weeks{studentProfile?.group ? ` · your assigned group is ${studentProfile.group}${studentProfile.subgroup ? ` / ${studentProfile.subgroup}` : ""}` : ""}</p></div><button className="button primary" onClick={() => setPage("timetable")}>Done</button></div><div className="info-banner"><span>ⓘ</span><span>{studentProfile?.group ? "Your allocated engineering group, subgroup, workshops and drawing room are applied from your profile. You can still hide timetable activity groups you do not attend." : "Choose the tutorials, labs and activity groups you attend. Lectures are usually shared across a course. Your choices are saved in this browser."}</span></div><div className="group-sections">{groupOptions.map((group) => <section className="group-section" key={group.key}><div className="group-heading"><strong>{group.module}</strong><small>{group.count} {group.count === 1 ? "class" : "classes"}</small></div><div className="group-chips"><label className={`group-chip ${hiddenGroups.has(group.key) ? "off" : ""}`}><input type="checkbox" checked={!hiddenGroups.has(group.key)} onChange={() => toggleGroup(group.key)} />{group.label}</label></div></section>)}{!groupOptions.length && <div className="empty-day">Load your timetable to see its class groups.</div>}</div></section>
        </>}

        {page === "labs" && <>
          <div className="page-heading"><div><p className="eyebrow">Year 1 Engineering · Group {studentProfile?.group ?? "—"}</p><h1>Engineering Labs</h1><p className="subheading">Your profile-specific workshop, drawing and lab rotation. This schedule is private to your assigned group.</p></div><button className="button" onClick={() => setPage("timetable")}>Back to timetable</button></div>
          <section className="panel"><div className="panel-header"><div><h2>{labRotationEvents.length ? "Your rotation sessions" : "Rotation sessions"}</h2><p className="panel-subtitle">{labRotationEvents.length} sessions in the weeks currently loaded · rooms follow your allocation</p></div></div>
            {!studentProfile?.group ? <div className="empty-day"><div className="empty-icon">⚗</div><strong>Engineering profile needed</strong><p>Sign in with a resolved Year 1 Engineering profile to see the right rotation and room.</p></div> : !labRotationEvents.length ? <div className="empty-day"><div className="empty-icon">⚗</div><strong>No rotation sessions in the loaded weeks</strong><p>Move through the timetable to load nearby weeks, or check back when the semester rotation is available.</p><button className="button small" onClick={() => setPage("timetable")}>Open timetable</button></div> : <div className="rotation-list">{labRotationEvents.map((event) => <article className="rotation-row" key={event.id}><div className="rotation-date"><strong>{new Intl.DateTimeFormat("en-IE", { timeZone: TIME_ZONE, weekday: "short" }).format(new Date(event.start))}</strong><span>{monthDay(event.start)}</span></div><div className="rotation-details"><strong>{event.title}</strong><span>{event.moduleCode} · {event.groupLabel} · {clock(event.start)}–{clock(event.end)}</span></div><div className="rotation-room">⌖ {event.locations.join(", ") || "Room to be confirmed"}</div><button className={`button small ${skippedEventKeys.has(cancellationEventKey(event)) ? "selected" : ""}`} onClick={() => toggleSkippedAttendance(event)}>{skippedEventKeys.has(cancellationEventKey(event)) ? "Undo skip" : "I won't attend"}</button></article>)}</div>}
          </section>
        </>}

        {page === "deadlines" && <>
          <div className="page-heading"><div><p className="eyebrow">Stay ahead of the week</p><h1>Deadlines</h1><p className="subheading">Dates shared by students in {scheduleTitle.split(" ")[0]}.</p></div><button className="button primary" onClick={() => { setDeadlineModule(moduleKeys[0] ?? ""); setDeadlineDue(""); setDeadlineModal(true); }}>＋ Add deadline</button></div>
          <section className="panel"><div className="panel-header"><div><h2>Upcoming work</h2><p className="panel-subtitle">{deadlines.length} upcoming · {testsSoon} in-class {testsSoon === 1 ? "test" : "tests"}</p></div></div><div className="filter-row"><label className="search-box"><span aria-hidden="true">⌕</span><input type="search" placeholder="Search deadlines or modules" value={deadlineSearch} onChange={(event) => setDeadlineSearch(event.target.value)} /></label>{["All", "Assignments", "In-class tests"].map((filter) => <button key={filter} className={`filter-chip ${deadlineFilter === filter ? "active" : ""}`} onClick={() => setDeadlineFilter(filter)}>{filter}</button>)}</div>
            {deadlines.length ? <div style={{ overflowX: "auto" }}><table className="deadline-table"><thead><tr><th>Deadline</th><th>Due date</th><th>Classmates</th><th>My action</th></tr></thead><tbody>{deadlines.filter((item) => {
              const matches = `${item.title} ${item.moduleKey}`.toLowerCase().includes(deadlineSearch.toLowerCase());
              const filteredKind = deadlineFilter === "Assignments" ? !isSatInClass(item.kind) : deadlineFilter === "In-class tests" ? isSatInClass(item.kind) : true;
              return matches && filteredKind;
            }).map((item) => <tr key={item.id}><td><span className="table-title">{item.title}</span><span className="table-module">{item.moduleKey} · {kindOptions.find((option) => option.value === item.kind)?.label}{item.atGroupKey ? " · group-specific" : ""}</span></td><td><strong style={{ color: isSatInClass(item.kind) ? "#c95a62" : "#46516a" }}>{monthDay(item.due)}</strong><span className="table-module">{countdown(item.due)}</span></td><td><span className={`tag ${deadlineStandings[item.id]?.isConfirmed ? "green" : ""}`}>{deadlineStandings[item.id]?.confirmCount ?? 0} confirmed</span></td><td><div className="table-actions"><button className="button small" onClick={() => void toggleDeadlineConfirmation(item)}>{deadlineStandings[item.id]?.confirmedByMe ? "✓ Confirmed" : "Confirm"}</button>{item.isMine ? <button className="button small danger" onClick={() => void removeDeadline(item)}>Delete</button> : <button className="button small" onClick={() => { setDeadlineReportReason("wrong"); setSelectedDeadline(item); }}>More</button>}</div></td></tr>)}</tbody></table></div> : <div className="empty-day"><div className="empty-icon">✓</div><strong>No deadlines yet</strong><p style={{ margin: "7px 0 0" }}>Add a date to help your classmates plan ahead.</p><button className="button primary" style={{ marginTop: 14 }} onClick={() => { setDeadlineModule(moduleKeys[0] ?? ""); setDeadlineModal(true); }}>＋ Add a deadline</button></div>}</section>
        </>}

        {page === "account" && <>
          <div className="page-heading"><div><p className="eyebrow">Your student profile</p><h1>Account</h1><p className="subheading">Manage your sign-in and timetable preferences.</p></div></div>
          <div className="account-grid">
            <section className="panel"><div className="panel-header"><h2>Profile details</h2></div><div className="group-sections"><div className="group-section"><div className="group-heading"><strong>Name</strong><small>{name}</small></div></div><div className="group-section"><div className="group-heading"><strong>Email</strong><small>{user?.email}</small></div></div><div className="group-section"><div className="group-heading"><strong>Student number</strong><small>{profile?.studentId ?? "Not set"}</small></div></div><div className="group-section"><div className="group-heading"><strong>Your public ID</strong>{profile?.pi ? <button className="button small" onClick={() => void copyPublicId()}>{piCopied ? "Copied" : "Copy ID"}</button> : <small>Not assigned</small>}</div>{profile?.pi && <code className="public-id">{profile.pi}</code>}<small className="form-hint">Share with someone making you a trusted reporter. This ID is not a password.</small></div>{studentProfile && <div className="group-section"><div className="group-heading"><strong>Allocated group</strong><small>{studentProfile.group ? `${studentProfile.group}${studentProfile.subgroup ? ` · ${studentProfile.subgroup}` : ""}` : "Not matched"}</small></div><small className="form-hint">{studentProfile.workshop ? `Workshop ${studentProfile.workshop}` : ""}{studentProfile.drawing ? ` · Drawing ${studentProfile.drawing}` : ""}</small></div>}<div className="group-section"><div className="group-heading"><strong>Timetable</strong><small>{studentProfile?.group && !usingProgramme ? "Year 1 Engineering · profile schedule" : programme?.name ?? "Not selected"}</small></div><button className="button small" onClick={changeProgramme}>Browse public programmes</button></div></div></section>
            <section className="panel"><div className="panel-header"><h2>Preferences &amp; help</h2></div><div className="group-sections"><div className="group-section"><div className="group-heading"><strong>Appearance</strong></div><div className="appearance-options" role="group" aria-label="Appearance"><button className={appearance === "system" ? "selected" : ""} onClick={() => setAppearance("system")}>System</button><button className={appearance === "light" ? "selected" : ""} onClick={() => setAppearance("light")}>Light</button><button className={appearance === "dark" ? "selected" : ""} onClick={() => setAppearance("dark")}>Dark</button></div></div><div className="group-section"><div className="group-heading"><strong>Privacy &amp; legal</strong></div><div className="account-links"><a href={APP_LINKS.privacy} target="_blank" rel="noreferrer" onClick={(event) => { event.preventDefault(); void openExternal(APP_LINKS.privacy); }}>Privacy policy <span aria-hidden="true">↗</span></a><a href={APP_LINKS.terms} target="_blank" rel="noreferrer" onClick={(event) => { event.preventDefault(); void openExternal(APP_LINKS.terms); }}>Terms of use <span aria-hidden="true">↗</span></a><a href={APP_LINKS.support} target="_blank" rel="noreferrer" onClick={(event) => { event.preventDefault(); void openExternal(APP_LINKS.support); }}>Help and contact <span aria-hidden="true">↗</span></a></div></div><div className="group-section"><div className="group-heading"><strong>Hidden deadline authors</strong><small>{hiddenAuthorCount}</small></div><p className="form-hint">Deadlines from these authors are hidden from your list.</p><button className="button small" disabled={!hiddenAuthorCount} onClick={() => void clearHiddenAuthors()}>Unhide all authors</button></div><button className="button" style={{ width: "100%", marginBottom: 9 }} onClick={() => void signOut()}>Sign out</button><button className="button danger" style={{ width: "100%" }} onClick={() => { if (window.confirm("Delete your student account? This cannot be undone.")) void deleteAccount(); }}>Delete account</button><small className="form-hint">An independent student project. Not affiliated with or endorsed by Dublin City University.</small></div></section>
          </div>
        </>}
      </div>
      <nav className="mobile-nav" aria-label="Main navigation">{navItems.map((item) => <button key={item.id} type="button" className={`nav-item ${page === item.id ? "active" : ""}`} onClick={() => setPage(item.id)}><Icon>{item.icon}</Icon>{item.title}</button>)}</nav>
    </main>

    {selectedEvent && (() => {
      const key = cancellationEventKey(selectedEvent);
      const report = cancellations[key] ?? { eventKey: key, reportCount: 0, onCount: 0, myStance: null, netReports: 0, isFlagged: false };
      const isSkipped = skippedEventKeys.has(key);
      const associated = deadlines.filter((deadline) => deadline.moduleKey === selectedEvent.moduleCode
        && (!deadline.atGroupKey || deadline.atGroupKey === selectedEvent.groupKey));
      return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedEvent(null); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="class-dialog-title"><div className="modal-head"><div><p className="eyebrow">Class details</p><h2 id="class-dialog-title">{selectedEvent.title}</h2><p>{selectedEvent.moduleCode} · {selectedEvent.groupLabel}</p></div><button className="icon-button modal-close" aria-label="Close details" onClick={() => setSelectedEvent(null)}>×</button></div><div className="class-detail-grid"><div className="detail-box"><small>When (Dublin time)</small><strong>{new Intl.DateTimeFormat("en-IE", { timeZone: TIME_ZONE, weekday: "long", month: "short", day: "numeric" }).format(new Date(effectiveStart(selectedEvent)))}<br />{clock(effectiveStart(selectedEvent))} – {clock(effectiveEnd(selectedEvent))}</strong></div><div className="detail-box"><small>Where</small><strong>{selectedEvent.verdict?.roomOverride ?? (selectedEvent.locations.join(", ") || "Location TBC")}</strong></div><div className="detail-box"><small>Activity</small><strong>{selectedEvent.activity.raw || selectedEvent.groupLabel}</strong></div><div className="detail-box"><small>Staff</small><strong>{selectedEvent.staff.join(", ") || "Not listed"}</strong></div></div>
        {selectedEvent.verdict && <div className="report-card"><h3>{selectedEvent.verdict.state === "cancelled" ? "Class cancelled" : selectedEvent.verdict.state === "moved" ? "Class moved" : "Class going ahead"}</h3><p>{selectedEvent.verdict.note || selectedEvent.verdict.decidedByLabel || "Confirmed update"}{selectedEvent.verdict.startOverride ? ` · ${clock(selectedEvent.verdict.startOverride)}` : ""}{selectedEvent.verdict.roomOverride ? ` · ${selectedEvent.verdict.roomOverride}` : ""}</p></div>}
        {clashes.has(selectedEvent.id) && <div className="status-banner">⚠ This class overlaps another class in your selected groups.</div>}
        <div className="report-card attendance-card"><h3>Your attendance</h3><p>This is private to your account on this device. It does not report the class as cancelled and is never shared.</p><button className={`button ${isSkipped ? "selected" : ""}`} onClick={() => toggleSkippedAttendance(selectedEvent)}>{isSkipped ? "Undo · I will attend" : "I won't attend this"}</button></div>
        <div className="report-card"><h3>{selectedEvent.verdict ? "Community reports (overridden)" : "Is this class going ahead?"}</h3><p>{selectedEvent.verdict ? "A trusted class decision is authoritative and takes precedence over these student reports." : "Reports are anonymous to other students. A class is flagged after enough people report it cancelled and the reports outweigh confirmations that it went ahead."}</p><div className="report-status"><span className={`report-dot ${report.isFlagged ? "warn" : report.onCount > 0 ? "good" : ""}`} />{report.isFlagged ? `${report.reportCount} report${report.reportCount === 1 ? "" : "s"} say cancelled` : report.reportCount ? `${report.reportCount} cancellation report${report.reportCount === 1 ? "" : "s"} · ${report.onCount} say it went ahead` : "No cancellation reports"}</div>{report.myStance && <div className="report-status" style={{ display: "flex" }}>Your report: {report.myStance === "cancelled" ? "cancelled" : "class went ahead"}</div>}{!selectedEvent.verdict && <div className="report-actions">{report.myStance ? <button className="button small" disabled={detailBusy} onClick={() => void reportClass(selectedEvent, null)}>Undo my report</button> : <><button className="button small danger" disabled={detailBusy} onClick={() => void reportClass(selectedEvent, "cancelled")}>Report cancelled</button>{report.reportCount > 0 && <button className="button small" disabled={detailBusy} onClick={() => void reportClass(selectedEvent, "on")}>It went ahead</button>}</>}</div>}</div>
        {maySetVerdict(profile) && selectedEvent.moduleCode && <div className="report-card"><h3>Trusted class decision</h3><p>Set the authoritative class status. It overrides crowd reports for all students.</p><div className="form-grid"><div className="form-field"><label htmlFor="verdict-note">Note (optional)</label><input id="verdict-note" placeholder="Add context" value={trustedVerdictNote} onChange={(event) => setTrustedVerdictNote(event.target.value)} /></div><div className="form-field"><label htmlFor="verdict-room">Room override (optional)</label><input id="verdict-room" placeholder="Room or location" value={trustedVerdictRoom} onChange={(event) => setTrustedVerdictRoom(event.target.value)} /></div><div className="form-field"><label htmlFor="verdict-start">New start time (optional)</label><input id="verdict-start" type="datetime-local" value={trustedVerdictStart} onChange={(event) => setTrustedVerdictStart(event.target.value)} /></div></div><div className="report-actions" style={{ marginTop: 10 }}><button className="button small danger" disabled={detailBusy} onClick={() => void decideClass(selectedEvent, "cancelled")}>Mark cancelled</button><button className="button small" disabled={detailBusy} onClick={() => void decideClass(selectedEvent, "running")}>Mark running</button><button className="button small" disabled={detailBusy} onClick={() => void decideClass(selectedEvent, "moved")}>Mark moved</button>{selectedEvent.verdict && <button className="button small" disabled={detailBusy} onClick={() => void decideClass(selectedEvent, null)}>Clear decision</button>}</div></div>}
        {associated.length > 0 && <div className="report-card"><h3>Module deadlines</h3>{associated.map((deadline) => <div className="deadline-item" key={deadline.id}><span className={`deadline-kind ${isSatInClass(deadline.kind) ? "test" : ""}`}>▣</span><span className="deadline-copy"><strong>{deadline.title}</strong><small>{monthDay(deadline.due)} · {deadline.moduleKey}</small></span><span className="deadline-count">{countdown(deadline.due)}</span>{!deadline.isMine && <button className="button small" onClick={() => setSelectedDeadline(deadline)}>More</button>}</div>)}</div>}
      </section></div>;
    })()}

    {selectedDeadline && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedDeadline(null); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="deadline-action-title"><div className="modal-head"><div><p className="eyebrow">Shared by a classmate</p><h2 id="deadline-action-title">{selectedDeadline.title}</h2><p>{selectedDeadline.moduleKey} · {monthDay(selectedDeadline.due)} · {kindOptions.find((item) => item.value === selectedDeadline.kind)?.label}</p></div><button className="icon-button modal-close" aria-label="Close deadline actions" onClick={() => setSelectedDeadline(null)}>×</button></div><div className="report-card"><h3>Confirm this deadline</h3><p>Confirming helps classmates know the date is accurate.</p><button className="button small" onClick={() => void toggleDeadlineConfirmation(selectedDeadline)}>{deadlineStandings[selectedDeadline.id]?.confirmedByMe ? "Withdraw confirmation" : "Confirm date"}</button></div><div className="report-card"><h3>Report this deadline</h3><p>Report content that is offensive, spam, or has an incorrect date.</p><div className="form-field"><label htmlFor="deadline-report-reason">Reason</label><select id="deadline-report-reason" value={deadlineReportReason} onChange={(event) => setDeadlineReportReason(event.target.value as typeof deadlineReportReason)}><option value="wrong">Wrong date or details</option><option value="spam">Spam</option><option value="offensive">Offensive</option><option value="other">Other</option></select></div><div className="report-actions" style={{ marginTop: 11 }}><button className="button small danger" onClick={() => { void moderateDeadline(selectedDeadline, "report"); setSelectedDeadline(null); }}>Submit report</button><button className="button small" onClick={() => { void moderateDeadline(selectedDeadline, "hide"); setSelectedDeadline(null); }}>Hide this author's deadlines</button></div></div><div className="modal-actions"><button className="button" onClick={() => setSelectedDeadline(null)}>Done</button></div></section></div>}

    {deadlineModal && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeadlineModal(false); }}><form className="modal" role="dialog" aria-modal="true" aria-labelledby="deadline-dialog-title" onSubmit={saveDeadline}><div className="modal-head"><div><p className="eyebrow">Help your classmates</p><h2 id="deadline-dialog-title">Add a deadline</h2><p>Shared with students taking this module.</p></div><button className="icon-button modal-close" type="button" aria-label="Close" onClick={() => setDeadlineModal(false)}>×</button></div><div className="form-grid"><div className="form-field"><label htmlFor="deadline-title">Title</label><input id="deadline-title" required maxLength={120} placeholder="e.g. Lab report 2" value={deadlineTitle} onChange={(event) => setDeadlineTitle(event.target.value)} /></div><div className="form-field"><label htmlFor="deadline-module">Module</label><select id="deadline-module" required value={deadlineModule} onChange={(event) => setDeadlineModule(event.target.value)}><option value="" disabled>Select a module</option>{moduleKeys.map((module) => <option key={module} value={module}>{module}</option>)}</select></div><div className="form-field"><label htmlFor="deadline-kind">Type</label><select id="deadline-kind" value={deadlineKind} onChange={(event) => setDeadlineKind(event.target.value as DeadlineKind)}>{kindOptions.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}</select></div><div className="form-field"><label htmlFor="deadline-due">Due date and time</label><input id="deadline-due" type="datetime-local" required value={deadlineDue} onChange={(event) => setDeadlineDue(event.target.value)} /></div><div className="form-field"><label htmlFor="deadline-group">Class group (optional)</label><select id="deadline-group" value={deadlineGroup} onChange={(event) => setDeadlineGroup(event.target.value)}><option value="">All groups in this module</option>{[...new Map(Object.values(eventsByWeek).flat().filter((item) => item.moduleCode === deadlineModule).map((item) => [item.groupKey, item])).values()].map((item) => <option key={item.groupKey} value={item.groupKey}>{item.groupLabel}</option>)}</select><small className="form-hint">Use a group-specific deadline if only one lab or tutorial stream has it.</small></div></div>{globalError && <p className="form-error" style={{ marginTop: 13 }}>{globalError}</p>}<div className="modal-actions"><button className="button" type="button" onClick={() => setDeadlineModal(false)}>Cancel</button><button className="button primary" type="submit" disabled={deadlineBusy || !moduleKeys.length}>{deadlineBusy ? "Saving…" : "Share deadline"}</button></div></form></div>}
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}

export default App;
