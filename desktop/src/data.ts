import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import engineeringYear1Json from "../../mobile/assets/data/EngineeringYear1.json";
import engineeringLabRotationJson from "../../mobile/assets/data/EngineeringLabRotation.json";
import type {
  AccountProfile,
  ActivityCode,
  ActivityKind,
  Allocation,
  AllocationResolution,
  AppRole,
  AuthenticatedUser,
  CancellationStatus,
  CancellationTally,
  DeadlineKind,
  DeadlineStanding,
  EventType,
  ModuleDeadline,
  EventVerdict,
  Profile,
  ReportStance,
  RosterSummary,
  SignUpResult,
  TeachingWeek,
  TimetableCategory,
  TimetableEvent,
  TimetableSnapshot,
  WeekCalendar,
} from "./types";

export * from "./types";

const configuredUrl = import.meta.env.VITE_SUPABASE_URL;
const configuredKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase: SupabaseClient | null = configuredUrl && configuredKey
  && !configuredUrl.includes("YOUR-PROJECT")
  ? createClient(configuredUrl, configuredKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  })
  : null;

const DCU_API = "https://scientia-eu-v4-api-d1-03.azurewebsites.net/api";
const DCU_INSTITUTION = "a1fdee6b-68eb-47b8-b2ac-a4c60c8e6177";
const CATEGORY_TYPES = {
  programme: "241e4d36-60e0-49f8-b27e-99416745d98d",
  module: "525fe79b-73c3-4b5c-8186-83c652b3adcc",
  location: "1e042cb1-547d-41d4-ae93-a1f2c3d34538",
} as const;
const CACHE_PREFIX = "dcu-timetable:v1:";
const DEADLINE_CONFIRM_THRESHOLD = 3;
const ENGINEERING_COURSE_KEY = "EEG1";

interface BundledRotation {
  title: string;
  modules: Record<string, { name: string }>;
  sessions: Array<{
    week: number; date: string; day: string; start: string; end: string;
    module: string; activity: string; groups: string[];
  }>;
}

const ENGINEERING_MODULES = engineeringYear1Json.modules;
const BUNDLED_ROTATION = engineeringLabRotationJson as BundledRotation;

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export interface StudentDataOptions {
  supabase: SupabaseClient;
  fetcher?: typeof fetch;
  storage?: Storage | null;
  dcuApiBase?: string;
  institutionId?: string;
}

interface SupabaseResult<T> {
  data: T | null;
  error: { message: string; code?: string; status?: number } | null;
}

interface CacheEnvelope<T> {
  value: T;
  fetchedAt: string;
}

interface RawWeek {
  WeekNumber: number;
  WeekLabel: string;
  FirstDayInWeek: string;
}

interface RawDay {
  Name: string;
  DayOfWeek: number;
}

interface RawCategory {
  Identity: string;
  Name: string;
  CategoryTypeIdentity?: string | null;
}

interface RawEvent {
  Identity?: string | null;
  StartDateTime?: string | null;
  EndDateTime?: string | null;
  EventType?: string | null;
  Location?: string | null;
  Name?: string | null;
  WeekLabels?: string | null;
  ExtraProperties?: Array<{ Name?: string | null; Value?: string | null }> | null;
}

interface RawEventGroup {
  Results?: RawEvent[] | null;
}

function throwIfError<T>(result: SupabaseResult<T>, fallback: string): T {
  if (result.error) {
    const error = new Error(result.error.message || fallback) as Error & {
      code?: string;
      status?: number;
    };
    error.code = result.error.code;
    error.status = result.error.status;
    throw error;
  }
  if (result.data === null) throw new Error(fallback);
  return result.data;
}

function parseRole(value: unknown): AppRole {
  return value === "trusted" || value === "admin" ? value : "student";
}

function mapProfile(row: Record<string, unknown>): AccountProfile {
  return {
    id: String(row.id ?? ""),
    role: parseRole(row.role),
    pi: typeof row.pi === "string" ? row.pi : null,
    displayName: typeof row.display_name === "string" ? row.display_name : null,
    bannedUntil: typeof row.banned_until === "string" ? row.banned_until : null,
    studentId: typeof row.student_id === "string" ? row.student_id : null,
  };
}

function normalizeStudentNumber(value: string): string {
  const normalised = value.toUpperCase().replace(/\s/g, "");
  if (!/^[A-Z][0-9]{8}$/.test(normalised)) {
    throw new Error("A student ID is one letter and eight digits, like A00000000.");
  }
  return normalised;
}

function parseActivity(rawName: string): ActivityCode {
  const trimmed = rawName.trim();
  const space = trimmed.indexOf(" ");
  let codePart = space < 0 ? trimmed : trimmed.slice(0, space);
  const tail = space < 0 ? "" : trimmed.slice(space + 1).trim();
  const cohort = tail && !tail.includes("[") && !tail.includes("/") ? tail : null;
  codePart = codePart.replace(/,+$/, "");
  const segments = codePart.split("/");
  const header = segments[0] ?? "";
  const occurrenceMatch = header.match(/^([^[]+)\[([^\]]+)\](.*)$/);
  const moduleCode = occurrenceMatch?.[1] ?? (header || null);
  const occurrence = occurrenceMatch?.[2] ?? null;
  const delivery = occurrenceMatch?.[3] || null;
  const activitySegment = segments[1] ?? "";
  const kindChar = activitySegment.match(/^[a-z]/i)?.[0]?.toUpperCase() ?? "?";
  const validKinds: ActivityKind[] = ["L", "T", "P", "S", "W"];
  const kind: ActivityKind = validKinds.includes(kindChar as ActivityKind)
    ? (kindChar as ActivityKind)
    : "?";
  const indexText = activitySegment.replace(/^[a-z]+/i, "");
  return {
    raw: rawName,
    moduleCode,
    occurrence,
    delivery,
    kind,
    activityIndex: /^\d+$/.test(indexText) ? Number(indexText) : null,
    group: segments[2] || null,
    cohort,
  };
}

function mapEvent(raw: RawEvent): TimetableEvent | null {
  if (!raw.StartDateTime || !raw.EndDateTime) return null;
  const start = new Date(raw.StartDateTime);
  const end = new Date(raw.EndDateTime);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;
  const extras = new Map(
    (raw.ExtraProperties ?? [])
      .filter((property) => property.Name && property.Value)
      .map((property) => [property.Name as string, property.Value as string]),
  );
  const activity = parseActivity(raw.Name ?? "");
  const typeText = (raw.EventType ?? "").toLowerCase();
  let type: EventType = "unknown";
  if (typeText.includes("on campus") || typeText.includes("on-campus")) type = "onCampus";
  else if (typeText.includes("async")) type = "asynchronous";
  else if (typeText.includes("sync")) type = "synchronous";
  else if (typeText.includes("booking")) type = "booking";
  const locations = (raw.Location ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const moduleName = extras.get("Module Name")?.trim() || null;
  const event: TimetableEvent = {
    id: raw.Identity || `${activity.raw}|${start.toISOString()}`,
    start: start.toISOString(),
    end: end.toISOString(),
    type,
    locations,
    moduleName,
    staff: extras.get("Staff Member")?.trim() ? [extras.get("Staff Member")!.trim()] : [],
    activity,
    weekLabels: (raw.WeekLabels ?? "").split(/[,;]/).map((label) => label.trim()).filter(Boolean),
    moduleCode: activity.moduleCode,
    title: moduleName ?? activity.moduleCode ?? activity.raw,
    groupKey: [activity.moduleCode ?? activity.raw,
      `${activity.kind}${activity.activityIndex ?? ""}`,
      activity.group ?? "", activity.cohort ?? ""].join("|"),
    groupLabel: [
      ({ L: "Lecture", T: "Tutorial", P: "Lab", S: "Seminar", W: "Workshop", "?": "Class" })[activity.kind]
        + ` ${activity.kind}${activity.activityIndex ?? ""}`,
      activity.group ? `Grp ${activity.group}` : "",
      activity.cohort ?? "",
    ].filter(Boolean).join(" · "),
  };
  return event;
}

function validStance(value: unknown): ReportStance | null {
  return value === "cancelled" || value === "on" ? value : null;
}

function dublinDate(date: string, time: string): string | null {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  let guess = wanted;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(guess))
      .map((part) => [part.type, part.value]));
    const actual = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute));
    guess += wanted - actual;
  }
  return new Date(guess).toISOString();
}

function dublinParts(instant: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
}

function applyTimetableChanges(
  initial: TimetableEvent[], changes: Array<Record<string, unknown>>, profile: Profile, weeks: TeachingWeek[],
): TimetableEvent[] {
  const applicable = changes.filter((change) => change.course_key === (profile.courseKey ?? ENGINEERING_COURSE_KEY)
    && (change.grp == null || change.grp === profile.group || change.grp === profile.subgroup));
  const removals = applicable.filter((change) => change.kind === "remove");
  const events = initial.filter((event) => {
    const { date, time } = dublinParts(event.start);
    const eventCode = (event.activity.raw.trim().split(/\s+/)[0] ?? "").replace(/,+$/, "");
    return !removals.some((change) => change.module === event.moduleCode && change.start_time === time
      && Array.isArray(change.dates) && change.dates.includes(date)
      && (!change.activity_code || change.activity_code === eventCode));
  });
  for (const change of applicable.filter((item) => item.kind === "add")) {
    if (typeof change.end_time !== "string") continue;
    for (const date of Array.isArray(change.dates) ? change.dates : []) {
      if (typeof date !== "string") continue;
      const onARequestedWeek = weeks.some((week) => {
        const day = new Date(`${date}T12:00:00`);
        const first = new Date(week.firstDay);
        const last = new Date(first.getTime() + 7 * 86400000);
        return day.getTime() >= first.getTime() - 12 * 3600000 && day.getTime() < last.getTime();
      });
      if (!onARequestedWeek) continue;
      const start = dublinDate(date, String(change.start_time ?? ""));
      const end = dublinDate(date, change.end_time);
      if (!start || !end) continue;
      const module = String(change.module ?? "");
      const title = String(change.title ?? "Class");
      const activity = parseActivity(module);
      events.push({
        id: `change-${String(change.id)}-${date}`, start, end, type: "onCampus",
        locations: typeof change.room === "string" ? [change.room] : [],
        moduleName: `${title} · ${module}`, title: `${title} · ${module}`, staff: [], activity,
        weekLabels: [], moduleCode: activity.moduleCode,
        groupKey: [activity.moduleCode ?? activity.raw, "?", "", ""].join("|"), groupLabel: title,
      });
    }
  }
  return events.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

function isInProfileGroup(event: TimetableEvent, profile: Profile): boolean {
  const kind = event.activity.kind;
  if (kind === "L" || kind === "?" || !event.activity.group) return true;
  const targets = [profile.group, profile.subgroup].filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim().toUpperCase());
  const eventGroup = event.activity.group.trim().toUpperCase();
  if (targets.includes(eventGroup)) return true;

  // DCU labels some attendance groups by surname range instead of the roster's
  // allocation code. The verified-address profile name is the source of this initial.
  const familyName = profile.name.trim().split(/\s+/).at(-1) ?? "";
  const initial = familyName[0]?.toLocaleUpperCase("en-IE");
  const cohortRange = event.activity.cohort?.match(/\b([A-Z])\s*[-–—]\s*([A-Z])\b/i);
  if (initial && cohortRange) {
    const letter = initial.charCodeAt(0);
    return letter >= cohortRange[1].toUpperCase().charCodeAt(0)
      && letter <= cohortRange[2].toUpperCase().charCodeAt(0);
  }
  // An explicitly grouped non-lecture event with no matching identity is not shown:
  // guessing would put another student's class on this profile's timetable.
  return false;
}

function mapDeadline(row: Record<string, unknown>): ModuleDeadline {
  const validKinds: DeadlineKind[] = ["assignment", "labReport", "quiz", "exam", "presentation", "other"];
  const kind = validKinds.includes(row.kind as DeadlineKind) ? row.kind as DeadlineKind : "other";
  return {
    id: String(row.id),
    moduleKey: String(row.module_key),
    atGroupKey: typeof row.at_group_key === "string" ? row.at_group_key : null,
    title: String(row.title),
    due: String(row.due_at),
    kind,
    submittedAt: String(row.submitted_at ?? ""),
    isMine: row.is_mine === true,
  };
}

/** Browser-side services shared by the student desktop UI. Supabase auth/session persistence
 * is delegated to the supplied Supabase JS client; timetable data is cached in localStorage.
 */
export class StudentDataService {
  private readonly supabase: SupabaseClient;
  private readonly fetcher: typeof fetch;
  private readonly storage: Storage | null;
  private readonly apiBase: string;
  private readonly institutionId: string;
  private readonly nativeHttp: boolean;
  private readonly liveCacheKeys = new Set<string>();

  constructor(options: StudentDataOptions) {
    this.supabase = options.supabase;
    this.nativeHttp = options.fetcher === undefined && isTauri();
    this.fetcher = options.fetcher ?? (this.nativeHttp ? tauriFetch : fetch.bind(globalThis));
    this.storage = options.storage === undefined
      ? (typeof localStorage === "undefined" ? null : localStorage)
      : options.storage;
    this.apiBase = (options.dcuApiBase ?? DCU_API).replace(/\/+$/, "");
    this.institutionId = options.institutionId ?? DCU_INSTITUTION;
  }

  // MARK: Authentication and profile

  async signUp(email: string, password: string, studentNumber?: string): Promise<SignUpResult> {
    const address = email.trim().toLowerCase();
    const parts = address.split("@");
    if (parts.length !== 2 || !parts[0] || !["dcu.ie", "mail.dcu.ie"].includes(parts[1])) {
      throw new Error("Use your @dcu.ie or @mail.dcu.ie address.");
    }
    const { data, error } = await this.supabase.auth.signUp({ email: address, password });
    if (error) throw error;
    const user = data.user ? { id: data.user.id, email: data.user.email ?? address } : null;
    if (!data.session || !user) {
      return { user, needsEmailConfirmation: true, profile: null };
    }
    if (studentNumber?.trim()) await this.setStudentNumber(studentNumber);
    return { user, needsEmailConfirmation: false, profile: await this.myProfile() };
  }

  async signIn(email: string, password: string): Promise<{ user: AuthenticatedUser; profile: AccountProfile | null }> {
    const { data, error } = await this.supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw error;
    if (!data.user) throw new Error("Sign-in succeeded without a user profile.");
    return {
      user: { id: data.user.id, email: data.user.email ?? email.trim() },
      profile: await this.myProfile(),
    };
  }

  async signOut(): Promise<void> {
    const { error } = await this.supabase.auth.signOut();
    if (error) throw error;
  }

  async resendConfirmation(email: string): Promise<void> {
    const { error } = await this.supabase.auth.resend({ type: "signup", email: email.trim() });
    if (error) throw error;
  }

  async sendPasswordReset(email: string, redirectTo?: string): Promise<void> {
    const { error } = await this.supabase.auth.resetPasswordForEmail(email.trim(),
      redirectTo ? { redirectTo } : undefined);
    if (error) throw error;
  }

  async currentUser(): Promise<AuthenticatedUser | null> {
    const { data, error } = await this.supabase.auth.getUser();
    if (error) throw error;
    return data.user ? { id: data.user.id, email: data.user.email ?? "" } : null;
  }

  async myProfile(): Promise<AccountProfile | null> {
    const user = await this.currentUser();
    if (!user) return null;
    const result = await this.supabase.from("profiles")
      .select("id,role,pi,display_name,banned_until,student_id")
      .eq("id", user.id).maybeSingle() as SupabaseResult<Record<string, unknown>>;
    if (result.error) throw new Error(result.error.message);
    return result.data ? mapProfile(result.data) : null;
  }

  /** Student IDs are entered manually and set once through the server RPC. */
  async setStudentNumber(value: string): Promise<string> {
    const studentId = normalizeStudentNumber(value);
    const { error } = await this.supabase.rpc("set_student_id", { p_student_id: studentId });
    if (error) throw error;
    return studentId;
  }

  async resolveProfile(): Promise<Profile | null> {
    const user = await this.currentUser();
    if (!user) return null;
    const account = await this.myProfile();
    if (!account) return null;
    const local = user.email.split("@")[0] ?? "";
    const name = local.split(".").map((part) => part.replace(/\d+$/, ""))
      .filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
    const base: Profile = {
      ...account,
      name: account.displayName?.trim() || name,
      cohort: "engineeringYear1",
      group: null, subgroup: null, workshop: null, drawing: null,
      courseKey: ENGINEERING_COURSE_KEY, allocationKey: null, rosterVersion: null,
      allocationStatus: null,
    };
    const resolution = await this.resolveAllocation(ENGINEERING_COURSE_KEY);
    base.allocationStatus = resolution.status;
    if (resolution.status !== "matched") return base;
    const allocation = await this.allocation(ENGINEERING_COURSE_KEY, resolution.key);
    if (!allocation) return base;
    return {
      ...base,
      group: allocation.group,
      subgroup: allocation.subgroup,
      workshop: allocation.workshop,
      drawing: allocation.drawing,
      allocationKey: resolution.key,
      rosterVersion: resolution.version,
    };
  }

  async deleteAccount(): Promise<void> {
    const { error } = await this.supabase.rpc("delete_own_account");
    if (error) throw error;
  }

  // MARK: Roster allocations

  async rosters(): Promise<RosterSummary[]> {
    const result = await this.supabase.from("rosters").select("course_key,title,version")
      .order("course_key") as SupabaseResult<Array<Record<string, unknown>>>;
    return throwIfError(result, "Could not load course lists.").map((row) => ({
      courseKey: String(row.course_key), title: typeof row.title === "string" ? row.title : null,
      version: Number(row.version),
    }));
  }

  async resolveAllocation(courseKey: string, subgroup?: string | null): Promise<AllocationResolution> {
    const args: { p_course_key: string; p_subgroup?: string } = { p_course_key: courseKey };
    if (subgroup) args.p_subgroup = subgroup;
    const result = await this.supabase.rpc("resolve_allocation", args) as
      SupabaseResult<Array<{ status?: string; allocation_key?: string | null; version?: number | null }>>;
    const row = throwIfError(result, "Could not resolve your class allocation.")[0];
    if (!row) return { status: "notListed" };
    switch (row.status) {
      case "matched":
        return row.allocation_key && row.version != null
          ? { status: "matched", key: row.allocation_key, version: row.version }
          : { status: "notListed" };
      case "ambiguous": return { status: "ambiguous" };
      case "conflict": return { status: "conflict" };
      case "no_roster": return { status: "noRoster" };
      default: return { status: "notListed" };
    }
  }

  async allocation(courseKey: string, key: string): Promise<Allocation | null> {
    const result = await this.supabase.from("course_allocations")
      .select("grp,subgroup,day,workshop,drawing")
      .eq("course_key", courseKey).eq("allocation_key", `\\x${key}`).maybeSingle() as
      SupabaseResult<Record<string, unknown>>;
    if (result.error) throw new Error(result.error.message);
    if (!result.data) return null;
    return {
      group: String(result.data.grp),
      subgroup: typeof result.data.subgroup === "string" ? result.data.subgroup : null,
      day: typeof result.data.day === "string" ? result.data.day : null,
      workshop: typeof result.data.workshop === "string" ? result.data.workshop : null,
      drawing: typeof result.data.drawing === "string" ? result.data.drawing : null,
    };
  }

  async subgroups(courseKey: string): Promise<string[]> {
    const result = await this.supabase.from("course_allocations").select("subgroup")
      .eq("course_key", courseKey) as SupabaseResult<Array<{ subgroup: string | null }>>;
    return [...new Set(throwIfError(result, "Could not load class groups.")
      .map((row) => row.subgroup).filter((value): value is string => Boolean(value)))].sort();
  }

  // MARK: Public DCU timetable API

  async searchProgrammes(query: string, page = 1): Promise<TimetableCategory[]> {
    const normalized = query.trim();
    const cacheKey = `programme-search:${page}:${normalized.toLowerCase()}`;
    try {
      const url = new URL(`${this.apiBase}/Public/CategoryTypes/${CATEGORY_TYPES.programme}`
        + `/Categories/FilterWithCache/${this.institutionId}`);
      url.search = new URLSearchParams({ query: normalized, itemsPerPage: "50", pageNumber: String(page),
        returnOccurrences: "false" }).toString();
      const response = await this.publicPost<{ Results?: RawCategory[] }>(url.toString(), []);
      const categories = (response.Results ?? []).map((item) => ({
        identity: item.Identity,
        name: item.Name,
        categoryTypeIdentity: item.CategoryTypeIdentity ?? CATEGORY_TYPES.programme,
      }));
      this.writeCache(cacheKey, categories);
      return categories;
    } catch (error) {
      const cached = this.readCache<TimetableCategory[]>(cacheKey);
      if (cached) return cached.value;
      throw error;
    }
  }

  async weekCalendar(): Promise<WeekCalendar> {
    try {
      const response = await this.publicGet<{ Weeks?: RawWeek[]; Days?: RawDay[] }>(
        `Public/ViewOptions/${this.institutionId}`);
      const calendar: WeekCalendar = {
        weeks: (response.Weeks ?? []).filter((week) => Number.isFinite(week.WeekNumber)
          && Number.isFinite(Date.parse(week.FirstDayInWeek)))
          .map((week) => ({ number: week.WeekNumber, label: week.WeekLabel,
            firstDay: new Date(week.FirstDayInWeek).toISOString() }))
          .sort((a, b) => Date.parse(a.firstDay) - Date.parse(b.firstDay)),
        days: (response.Days ?? []).map((day) => ({ name: day.Name, dayOfWeek: day.DayOfWeek })),
      };
      this.writeCache("week-calendar", calendar);
      return calendar;
    } catch (error) {
      const cached = this.readCache<WeekCalendar>("week-calendar");
      if (cached) return cached.value;
      throw error;
    }
  }

  async events(category: TimetableCategory, weeks: TeachingWeek[]): Promise<TimetableEvent[]> {
    const wanted = [...new Map(weeks.map((week) => [week.number, week])).values()];
    if (!wanted.length) return [];
    const cachedByWeek = new Map<number, TimetableSnapshot>();
    for (const week of wanted) {
      const cacheKey = `events:${category.identity}:${week.number}`;
      const cached = this.readCache<TimetableSnapshot>(cacheKey);
      if (cached) cachedByWeek.set(week.number, { ...cached.value, offline: !this.liveCacheKeys.has(cacheKey) });
    }
    try {
      const options = await this.publicGet<{ Weeks?: RawWeek[]; Days?: RawDay[] }>(
        `Public/ViewOptions/${this.institutionId}`);
      const numbers = new Set(wanted.map((week) => week.number));
      const rawWeeks = (options.Weeks ?? []).filter((week) => numbers.has(week.WeekNumber))
        .sort((a, b) => a.WeekNumber - b.WeekNumber);
      if (!rawWeeks.length) return [];
      const first = new Date(rawWeeks[0].FirstDayInWeek);
      const lastStart = new Date(rawWeeks[rawWeeks.length - 1].FirstDayInWeek);
      const end = new Date(lastStart.getTime() + 7 * 24 * 60 * 60 * 1000);
      const body = {
        ViewOptions: {
          Days: options.Days ?? [],
          Weeks: rawWeeks,
          TimePeriods: [{ Description: "All Day", StartTime: "00:00", EndTime: "23:59", IsDefault: true }],
          DatePeriods: [{ Description: "Range", StartDateTime: first.toISOString(),
            EndDateTime: end.toISOString(), IsDefault: true, Type: null }],
        },
        CategoryTypesWithIdentities: [{
          CategoryTypeIdentity: category.categoryTypeIdentity,
          CategoryIdentities: [category.identity],
        }],
        FetchBookings: false,
        FetchPersonalEvents: false,
        PersonalIdentities: [],
      };
      const response = await this.publicPost<{ CategoryEvents?: RawEventGroup[] }>(
        `Public/CategoryTypes/Categories/Events/Filter/${this.institutionId}`, body);
      const allEvents = (response.CategoryEvents ?? []).flatMap((group) => group.Results ?? [])
        .map(mapEvent).filter((event): event is TimetableEvent => event !== null)
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
      for (const week of wanted) {
        const start = Date.parse(week.firstDay);
        const endOfWeek = start + 7 * 24 * 60 * 60 * 1000;
        const weekEvents = allEvents.filter((event) => {
          const eventDate = Date.parse(event.start);
          return eventDate >= start && eventDate < endOfWeek;
        });
        const snapshot: TimetableSnapshot = {
          category, weekNumber: week.number, events: weekEvents,
          fetchedAt: new Date().toISOString(), offline: false,
        };
        this.writeCache(`events:${category.identity}:${week.number}`, snapshot);
        this.liveCacheKeys.add(`events:${category.identity}:${week.number}`);
        cachedByWeek.set(week.number, snapshot);
      }
      const events = wanted.flatMap((week) => cachedByWeek.get(week.number)?.events ?? [])
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
      try {
        const verdicts = await this.getVerdicts(events.map(cancellationEventKey));
        const byKey = new Map(verdicts.map((verdict) => [verdict.eventKey, verdict]));
        return events.map((event) => ({ ...event, verdict: byKey.get(cancellationEventKey(event)) ?? null }));
      } catch {
        return events;
      }
    } catch (error) {
      for (const week of wanted) this.liveCacheKeys.delete(`events:${category.identity}:${week.number}`);
      if (!cachedByWeek.size) throw error;
      const requested = new Set(wanted.map((week) => week.number));
      const available = wanted.filter((week) => cachedByWeek.has(week.number));
      if (available.length !== requested.size) throw error;
      return available.flatMap((week) => cachedByWeek.get(week.number)!.events)
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    }
  }

  async profileEvents(profile: Profile, weeks: TeachingWeek[]): Promise<TimetableEvent[]> {
    if (!weeks.length) return [];
    const cacheKey = (week: TeachingWeek) =>
      `profile-events:${profile.id}:${profile.courseKey ?? ENGINEERING_COURSE_KEY}:${profile.group ?? "programme"}:${profile.subgroup ?? ""}:${week.number}`;
    try {
      const moduleIdentities: string[] = [];
      for (const code of ENGINEERING_MODULES) {
        const url = new URL(`${this.apiBase}/Public/CategoryTypes/${CATEGORY_TYPES.module}`
          + `/Categories/FilterWithCache/${this.institutionId}`);
        url.search = new URLSearchParams({ query: code, itemsPerPage: "50", pageNumber: "1",
          returnOccurrences: "false" }).toString();
        const matches = await this.publicPost<{ Results?: RawCategory[] }>(url.toString(), []);
        const found = matches.Results?.find((item) => item.Name.toUpperCase().startsWith(code));
        if (found) moduleIdentities.push(found.Identity);
      }

      const options = await this.publicGet<{ Weeks?: RawWeek[]; Days?: RawDay[] }>(
        `Public/ViewOptions/${this.institutionId}`);
      const wantedNumbers = new Set(weeks.map((week) => week.number));
      const rawWeeks = (options.Weeks ?? []).filter((week) => wantedNumbers.has(week.WeekNumber))
        .sort((a, b) => a.WeekNumber - b.WeekNumber);
      let events: TimetableEvent[] = [];
      if (rawWeeks.length && moduleIdentities.length) {
        const first = new Date(rawWeeks[0].FirstDayInWeek);
        const last = new Date(rawWeeks[rawWeeks.length - 1].FirstDayInWeek);
        const body = {
          ViewOptions: {
            Days: options.Days ?? [], Weeks: rawWeeks,
            TimePeriods: [{ Description: "All Day", StartTime: "00:00", EndTime: "23:59", IsDefault: true }],
            DatePeriods: [{ Description: "Range", StartDateTime: first.toISOString(),
              EndDateTime: new Date(last.getTime() + 7 * 86400000).toISOString(), IsDefault: true, Type: null }],
          },
          CategoryTypesWithIdentities: [{ CategoryTypeIdentity: CATEGORY_TYPES.module,
            CategoryIdentities: moduleIdentities }],
          FetchBookings: false, FetchPersonalEvents: false, PersonalIdentities: [],
        };
        const response = await this.publicPost<{ CategoryEvents?: RawEventGroup[] }>(
          `Public/CategoryTypes/Categories/Events/Filter/${this.institutionId}`, body);
        events = (response.CategoryEvents ?? []).flatMap((group) => group.Results ?? [])
          .map(mapEvent).filter((event): event is TimetableEvent => event !== null);
      }

      const rotation = await this.loadRotation();
      if (rotation && profile.group) {
        const rotationModules = new Set(Object.keys(rotation.modules));
        events = events.filter((event) => !(rotationModules.has(event.moduleCode ?? "")
          && event.activity.kind === "P"));
        const wanted = new Set(weeks.map((week) => week.number));
        for (const session of rotation.sessions) {
          if (!wanted.has(session.week) || !session.groups.includes(profile.group)) continue;
          const start = dublinDate(session.date, session.start);
          const end = dublinDate(session.date, session.end);
          if (!start || !end) continue;
          const room = session.activity.toLowerCase().includes("workshop")
            ? profile.workshop : session.activity.toLowerCase().includes("drawing") ? profile.drawing : null;
          const activity = parseActivity(session.module);
          events.push({
            id: `rotation-${session.module}-${session.activity}-${session.date}-${session.start}`,
            start, end, type: "onCampus", locations: room ? [room] : [],
            moduleName: `${session.activity} · ${rotation.modules[session.module]?.name ?? session.module}`,
            staff: [], activity, moduleCode: activity.moduleCode,
            title: `${session.activity} · ${rotation.modules[session.module]?.name ?? session.module}`,
            weekLabels: [String(session.week)], groupKey: [session.module, "?", "", ""].join("|"),
            groupLabel: session.activity,
          });
        }
      }

      events = events.filter((event) => isInProfileGroup(event, profile));

      const courseKey = profile.courseKey ?? ENGINEERING_COURSE_KEY;
      const changes = await this.loadTimetableChanges(courseKey);
      events = applyTimetableChanges(events, changes, profile, weeks);
      const verdicts = await this.getVerdicts(events.map(cancellationEventKey)).catch(() => []);
      const byKey = new Map(verdicts.map((verdict) => [verdict.eventKey, verdict]));
      events = events.map((event) => ({ ...event, verdict: byKey.get(cancellationEventKey(event)) ?? null }))
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
      for (const week of weeks) {
        const start = Date.parse(week.firstDay);
        const weekEvents = events.filter((event) => Date.parse(event.start) >= start
          && Date.parse(event.start) < start + 7 * 86400000);
        this.writeCache(cacheKey(week), { ...weekEvents });
      }
      return events;
    } catch (error) {
      const cached = weeks.map((week) => this.readCache<TimetableEvent[]>(cacheKey(week))?.value);
      if (cached.every((value): value is TimetableEvent[] => value !== undefined)) return cached.flat();
      throw error;
    }
  }

  async getVerdicts(eventKeys: string[]): Promise<EventVerdict[]> {
    const keys = [...new Set(eventKeys)];
    if (!keys.length) return [];
    const result = await this.supabase.from("event_verdicts")
      .select("event_key,state,note,room_override,start_override,decided_by_label,decided_at")
      .in("event_key", keys) as SupabaseResult<Array<Record<string, unknown>>>;
    const rows = throwIfError(result, "Could not load class decisions.");
    const states = new Set(["cancelled", "running", "moved"]);
    return rows.filter((row) => states.has(String(row.state))).map((row) => ({
      eventKey: String(row.event_key), state: row.state as EventVerdict["state"],
      note: typeof row.note === "string" ? row.note : null,
      roomOverride: typeof row.room_override === "string" ? row.room_override : null,
      startOverride: typeof row.start_override === "string" ? row.start_override : null,
      decidedByLabel: typeof row.decided_by_label === "string" ? row.decided_by_label : null,
      decidedAt: String(row.decided_at ?? ""),
    }));
  }

  async setVerdict(eventKey: string, moduleKey: string, state: EventVerdict["state"],
    options: { note?: string; roomOverride?: string; startOverride?: string; label?: string } = {}): Promise<void> {
    const user = await this.currentUser();
    if (!user) throw new Error("Sign in to set a class decision.");
    const { error } = await this.supabase.from("event_verdicts").upsert({
      event_key: eventKey, module_key: moduleKey, state, decided_by: user.id,
      note: options.note ?? null, room_override: options.roomOverride ?? null,
      start_override: options.startOverride ?? null, decided_by_label: options.label ?? null,
    });
    if (error) throw error;
  }

  async clearVerdict(eventKey: string): Promise<void> {
    const { error } = await this.supabase.from("event_verdicts").delete().eq("event_key", eventKey);
    if (error) throw error;
  }

  async reportDeadline(id: string, reason: "offensive" | "spam" | "wrong" | "other"): Promise<void> {
    const { error } = await this.supabase.rpc("report_deadline", { p_deadline: id, p_reason: reason });
    if (error) throw error;
  }

  async hideDeadlineAuthor(id: string): Promise<void> {
    const { error } = await this.supabase.rpc("hide_author_of", { p_deadline: id });
    if (error) throw error;
  }

  async hiddenAuthorCount(): Promise<number> {
    const { data, error } = await this.supabase.rpc("hidden_author_count");
    if (error) throw error;
    return Number(data ?? 0);
  }

  async unhideAllAuthors(): Promise<void> {
    const { error } = await this.supabase.rpc("unhide_all_authors");
    if (error) throw error;
  }

  /** Snapshot access lets the UI label stale/offline data without refetching. */
  cachedEvents(categoryId: string, weekNumber: number): TimetableSnapshot | null {
    const cacheKey = `events:${categoryId}:${weekNumber}`;
    const snapshot = this.readCache<TimetableSnapshot>(cacheKey)?.value;
    return snapshot ? { ...snapshot, offline: !this.liveCacheKeys.has(cacheKey) } : null;
  }

  // MARK: Shared cancellations

  async cancellationTallies(eventKeys: string[]): Promise<CancellationTally[]> {
    const keys = [...new Set(eventKeys)];
    if (!keys.length) return [];
    const result = await this.supabase.from("cancellation_tallies")
      .select("event_key,report_count,on_count,my_stance")
      .in("event_key", keys) as SupabaseResult<Array<Record<string, unknown>>>;
    return throwIfError(result, "Could not load class reports.").map((row) => ({
      eventKey: String(row.event_key), reportCount: Number(row.report_count ?? 0),
      onCount: Number(row.on_count ?? 0), myStance: validStance(row.my_stance),
    }));
  }

  async submitCancellation(eventKey: string, reporterId: string, stance: ReportStance): Promise<void> {
    const { error } = await this.supabase.from("cancellation_reports").insert({
      event_key: eventKey, reporter_id: reporterId, stance,
    }, { defaultToNull: false });
    if (error && error.code !== "23505") throw error;
  }

  async withdrawCancellation(eventKey: string, reporterId: string): Promise<void> {
    const { error } = await this.supabase.from("cancellation_reports")
      .delete().eq("event_key", eventKey).eq("reporter_id", reporterId);
    if (error) throw error;
  }

  /** Stance changes are delete-then-insert because the table intentionally has no UPDATE policy. */
  async setCancellationStance(eventKey: string, reporterId: string, stance: ReportStance): Promise<void> {
    const current = (await this.cancellationTallies([eventKey]))[0]?.myStance;
    if (current === stance) return;
    if (current) await this.withdrawCancellation(eventKey, reporterId);
    await this.submitCancellation(eventKey, reporterId, stance);
  }

  cancellationStatus(tally?: CancellationTally): CancellationStatus {
    const value = tally ?? { eventKey: "", reportCount: 0, onCount: 0, myStance: null };
    const netReports = Math.max(0, value.reportCount - value.onCount);
    return { ...value, netReports,
      isFlagged: value.reportCount >= 3 && netReports >= 2 };
  }

  // MARK: Shared module deadlines

  async deadlines(moduleKeys: string[]): Promise<ModuleDeadline[]> {
    const keys = [...new Set(moduleKeys)];
    if (!keys.length) return [];
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const result = await this.supabase.from("module_deadlines_public")
      .select("id,module_key,at_group_key,title,due_at,kind,is_mine,submitted_at")
      .in("module_key", keys).gte("due_at", since.toISOString()).order("due_at", { ascending: true }) as
      SupabaseResult<Array<Record<string, unknown>>>;
    return throwIfError(result, "Could not load module deadlines.").map(mapDeadline);
  }

  async submitDeadline(deadline: {
    id?: string;
    moduleKey: string;
    atGroupKey?: string | null;
    title: string;
    due: string | Date;
    kind: DeadlineKind;
    submitterId: string;
  }): Promise<void> {
    const dueAt = deadline.due instanceof Date ? deadline.due.toISOString() : new Date(deadline.due).toISOString();
    if (!deadline.title.trim() || !Number.isFinite(Date.parse(dueAt))) {
      throw new Error("A deadline needs a title and valid due date.");
    }
    const id = deadline.id ?? crypto.randomUUID();
    const { error } = await this.supabase.from("module_deadlines").insert({
      id,
      module_key: deadline.moduleKey,
      at_group_key: deadline.atGroupKey ?? null,
      title: deadline.title.trim(),
      due_at: dueAt,
      kind: deadline.kind,
      submitter_id: deadline.submitterId,
    });
    if (error) throw error;
    await this.confirmDeadline(id, deadline.submitterId).catch(() => undefined);
  }

  async withdrawDeadline(id: string): Promise<void> {
    const { error } = await this.supabase.from("module_deadlines").delete().eq("id", id);
    if (error) throw error;
  }

  async deadlineStandings(ids: string[]): Promise<Record<string, DeadlineStanding>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return {};
    const result = await this.supabase.from("deadline_confirmation_tallies")
      .select("deadline_id,confirm_count,mine").in("deadline_id", unique) as
      SupabaseResult<Array<Record<string, unknown>>>;
    const rows = throwIfError(result, "Could not load deadline confirmations.");
    const standings: Record<string, DeadlineStanding> = {};
    for (const row of rows) {
      const count = Number(row.confirm_count ?? 0);
      standings[String(row.deadline_id)] = {
        confirmCount: count, confirmedByMe: row.mine === true,
        isConfirmed: count >= DEADLINE_CONFIRM_THRESHOLD,
      };
    }
    return standings;
  }

  async confirmDeadline(deadlineId: string, confirmerId: string): Promise<void> {
    const { error } = await this.supabase.from("deadline_confirmations").insert({
      deadline_id: deadlineId, confirmer_id: confirmerId,
    });
    if (error && error.code !== "23505") throw error;
  }

  async unconfirmDeadline(deadlineId: string, confirmerId: string): Promise<void> {
    const { error } = await this.supabase.from("deadline_confirmations")
      .delete().eq("deadline_id", deadlineId).eq("confirmer_id", confirmerId);
    if (error) throw error;
  }

  private async loadRotation(): Promise<BundledRotation | null> {
    try {
      const result = await this.supabase.from("lab_rotations")
        .select("version,title,lab_rotation_sessions(week,date,day,start_time,end_time,module,activity,groups)")
        .eq("course_key", ENGINEERING_COURSE_KEY).maybeSingle() as SupabaseResult<{
          version: number; title: string | null;
          lab_rotation_sessions: Array<{
            week: number | null; date: string | null; day: string | null;
            start_time: string | null; end_time: string | null; module: string | null;
            activity: string | null; groups: string[] | null;
          }> | null;
        }>;
      if (result.error) throw new Error(result.error.message);
      if (!result.data) return BUNDLED_ROTATION;
      return {
        title: result.data.title ?? BUNDLED_ROTATION.title,
        modules: BUNDLED_ROTATION.modules,
        sessions: (result.data.lab_rotation_sessions ?? []).flatMap((session) => {
          if (!session.week || !session.date || !session.start_time || !session.end_time
            || !session.module || !session.groups?.length) return [];
          return [{ week: session.week, date: session.date, day: session.day ?? "",
            start: session.start_time, end: session.end_time, module: session.module,
            activity: session.activity ?? "", groups: session.groups }];
        }),
      };
    } catch {
      return BUNDLED_ROTATION;
    }
  }

  private async loadTimetableChanges(courseKey: string): Promise<Array<Record<string, unknown>>> {
    const cacheKey = `timetable-changes:${courseKey}`;
    try {
      const result = await this.supabase.from("timetable_changes")
        .select("id,course_key,grp,kind,module,activity_code,title,dates,start_time,end_time,room")
        .eq("course_key", courseKey).order("created_at") as
        SupabaseResult<Array<Record<string, unknown>>>;
      const changes = throwIfError(result, "Could not load timetable changes.");
      this.writeCache(cacheKey, changes);
      return changes;
    } catch {
      return this.readCache<Array<Record<string, unknown>>>(cacheKey)?.value ?? [];
    }
  }

  // MARK: Internals

  private async publicGet<T>(path: string): Promise<T> {
    return this.publicRequest<T>(`${this.apiBase}/${path}`, "GET");
  }

  private async publicPost<T>(pathOrUrl: string, body: unknown): Promise<T> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${this.apiBase}/${pathOrUrl}`;
    return this.publicRequest<T>(url, "POST", body);
  }

  private async publicRequest<T>(url: string, method: "GET" | "POST", body?: unknown): Promise<T> {
    const response = await this.fetcher(url, {
      method,
      headers: {
        Authorization: "Anonymous",
        "Content-Type": "application/json",
        ...(this.nativeHttp ? { Origin: "https://mytimetable.dcu.ie",
          Referer: "https://mytimetable.dcu.ie/" } : {}),
      },
      ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(`DCU timetable request failed (${response.status}).`);
    return response.json() as Promise<T>;
  }

  private readCache<T>(key: string): CacheEnvelope<T> | null {
    try {
      const value = this.storage?.getItem(CACHE_PREFIX + key);
      return value ? JSON.parse(value) as CacheEnvelope<T> : null;
    } catch {
      return null;
    }
  }

  private writeCache<T>(key: string, value: T): void {
    try {
      this.storage?.setItem(CACHE_PREFIX + key, JSON.stringify({ value, fetchedAt: new Date().toISOString() }));
    } catch {
      // Storage may be disabled or full; live network results remain usable.
    }
  }
}

export function createStudentDataService(options: StudentDataOptions): StudentDataService {
  return new StudentDataService(options);
}

/** Same stable cancellation key used by the iOS client, independent of DCU's event ID. */
export function cancellationEventKey(event: TimetableEvent): string {
  return `${event.activity.raw}|${new Date(event.start).toISOString().replace(/\.\d{3}Z$/, "Z")}`;
}

function appService(): StudentDataService {
  if (!supabase) throw new Error("Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
  return appServiceInstance ??= createStudentDataService({ supabase });
}

let appServiceInstance: StudentDataService | undefined;

/** Signs in with the supplied DCU address and password. */
export function signIn(email: string, password: string) {
  return appService().signIn(email, password);
}

/** Creates an account; when email confirmation is enabled, result.needsEmailConfirmation is true. */
export function signUp(email: string, password: string): Promise<SignUpResult> {
  return appService().signUp(email, password);
}

/** Saves the student's manually entered number; server RPC allows setting it only once. */
export function saveStudentNumber(number: string): Promise<string> {
  return appService().setStudentNumber(number);
}

/** Loads the account and resolves the signed-in student's supported Engineering allocation. */
export function resolveProfile(): Promise<Profile | null> {
  return appService().resolveProfile();
}

export function searchProgrammes(query: string): Promise<TimetableCategory[]> {
  return appService().searchProgrammes(query);
}

export async function getWeeks(): Promise<TeachingWeek[]> {
  return (await appService().weekCalendar()).weeks;
}

export function getEvents(category: TimetableCategory, weeks: TeachingWeek[]): Promise<TimetableEvent[]> {
  return appService().events(category, weeks);
}

export function getProfileEvents(profile: Profile, weeks: TeachingWeek[]): Promise<TimetableEvent[]> {
  return appService().profileEvents(profile, weeks);
}

export function getDeadlines(modules: string[]): Promise<ModuleDeadline[]> {
  return appService().deadlines(modules);
}

export async function addDeadline(input: {
  moduleKey: string;
  title: string;
  due: string | Date;
  kind: DeadlineKind;
  atGroupKey?: string | null;
}): Promise<void> {
  const service = appService();
  const user = await service.currentUser();
  if (!user) throw new Error("Sign in to share a deadline.");
  await service.submitDeadline({ ...input, submitterId: user.id });
}

export function getReports(keys: string[]): Promise<CancellationTally[]> {
  return appService().cancellationTallies(keys);
}

export async function reportEvent(key: string, stance: ReportStance): Promise<void> {
  const service = appService();
  const user = await service.currentUser();
  if (!user) throw new Error("Sign in to report a class.");
  await service.setCancellationStance(key, user.id, stance);
}

export function getVerdicts(keys: string[]): Promise<EventVerdict[]> {
  return appService().getVerdicts(keys);
}

export function reportDeadline(id: string, reason: "offensive" | "spam" | "wrong" | "other"): Promise<void> {
  return appService().reportDeadline(id, reason);
}

export function hideDeadlineAuthor(id: string): Promise<void> {
  return appService().hideDeadlineAuthor(id);
}

export function hiddenAuthorCount(): Promise<number> {
  return appService().hiddenAuthorCount();
}

export function unhideAllAuthors(): Promise<void> {
  return appService().unhideAllAuthors();
}
