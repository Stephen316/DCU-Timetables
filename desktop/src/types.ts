export type AppRole = "student" | "trusted" | "admin";

export interface AuthenticatedUser {
  id: string;
  email: string;
}

export interface AccountProfile {
  id: string;
  role: AppRole;
  pi: string | null;
  displayName: string | null;
  bannedUntil: string | null;
  studentId: string | null;
}

export interface Profile extends AccountProfile {
  name: string;
  cohort: "engineeringYear1";
  group: string | null;
  subgroup: string | null;
  workshop: string | null;
  drawing: string | null;
  courseKey: string | null;
  allocationKey: string | null;
  rosterVersion: number | null;
  allocationStatus: AllocationResolution["status"] | null;
}

export interface SignUpResult {
  user: AuthenticatedUser | null;
  needsEmailConfirmation: boolean;
  profile: AccountProfile | null;
}

export interface Allocation {
  group: string;
  subgroup: string | null;
  day: string | null;
  workshop: string | null;
  drawing: string | null;
}

export interface RosterSummary {
  courseKey: string;
  title: string | null;
  version: number;
}

export type AllocationResolution =
  | { status: "matched"; key: string; version: number }
  | { status: "ambiguous" }
  | { status: "notListed" }
  | { status: "conflict" }
  | { status: "noRoster" };

export interface TimetableCategory {
  identity: string;
  name: string;
  categoryTypeIdentity: string;
}

export type Category = TimetableCategory;

export interface TeachingWeek {
  number: number;
  label: string;
  firstDay: string;
}

export type Week = TeachingWeek;

export interface DayOption {
  name: string;
  dayOfWeek: number;
}

export interface WeekCalendar {
  weeks: TeachingWeek[];
  days: DayOption[];
}

export type ActivityKind = "L" | "T" | "P" | "S" | "W" | "?";

export interface ActivityCode {
  raw: string;
  moduleCode: string | null;
  occurrence: string | null;
  delivery: string | null;
  kind: ActivityKind;
  activityIndex: number | null;
  group: string | null;
  cohort: string | null;
}

export type EventType = "onCampus" | "synchronous" | "asynchronous" | "booking" | "unknown";

export interface TimetableEvent {
  id: string;
  start: string;
  end: string;
  type: EventType;
  locations: string[];
  moduleName: string | null;
  staff: string[];
  activity: ActivityCode;
  weekLabels: string[];
  moduleCode: string | null;
  title: string;
  groupKey: string;
  groupLabel: string;
  verdict?: EventVerdict | null;
}

export type Event = TimetableEvent;

export interface TimetableSnapshot {
  category: TimetableCategory;
  weekNumber: number;
  events: TimetableEvent[];
  fetchedAt: string;
  offline: boolean;
}

export type DeadlineKind = "assignment" | "labReport" | "quiz" | "exam" | "presentation" | "other";

export interface ModuleDeadline {
  id: string;
  moduleKey: string;
  atGroupKey: string | null;
  title: string;
  due: string;
  kind: DeadlineKind;
  submittedAt: string;
  isMine: boolean;
}

export type Deadline = ModuleDeadline;

export type VerdictState = "cancelled" | "running" | "moved";

export interface EventVerdict {
  eventKey: string;
  state: VerdictState;
  note: string | null;
  roomOverride: string | null;
  startOverride: string | null;
  decidedByLabel: string | null;
  decidedAt: string;
}

export interface DeadlineStanding {
  confirmCount: number;
  confirmedByMe: boolean;
  isConfirmed: boolean;
}

export type ReportStance = "cancelled" | "on";

export interface CancellationTally {
  eventKey: string;
  reportCount: number;
  onCount: number;
  myStance: ReportStance | null;
}

export interface CancellationStatus extends CancellationTally {
  netReports: number;
  isFlagged: boolean;
}

export interface DataError extends Error {
  status?: number;
  code?: string;
}
