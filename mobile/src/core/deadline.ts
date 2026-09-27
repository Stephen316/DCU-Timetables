import { CancellationStatus, verdictSource } from './cancellation';
import { groupKeyOf, TimetableEvent } from './timetableEvent';
import { addDays, daysBetween, isSameDay, startOfDay, startOfWeek } from './time';
import { uuid } from './uuid';

export type DeadlineKind = 'assignment' | 'labReport' | 'quiz' | 'exam' | 'presentation' | 'other';
export const DEADLINE_KINDS: DeadlineKind[] = ['assignment', 'labReport', 'quiz', 'exam', 'presentation', 'other'];

export function isDeadlineKind(value: unknown): value is DeadlineKind {
  return typeof value === 'string' && (DEADLINE_KINDS as string[]).includes(value);
}

/**
 * Sat in the room (a quiz or an exam) rather than handed in. The two are flagged
 * differently because missing one is unrecoverable.
 */
export function isSatInClass(kind: DeadlineKind): boolean {
  return kind === 'quiz' || kind === 'exam';
}

export function deadlineKindLabel(kind: DeadlineKind): string {
  switch (kind) {
    case 'assignment': return 'Assignment';
    case 'labReport': return 'Lab report';
    case 'quiz': return 'Quiz';
    case 'exam': return 'Exam';
    case 'presentation': return 'Presentation';
    case 'other': return 'Other';
  }
}

/**
 * Where a moderator has put it. `blocked` rows never reach a student, so the app only ever
 * holds these two.
 */
export type DeadlineStatus = 'pending' | 'verified';

/** The database's limits, so a form can't offer what the server will refuse. */
export const TITLE_LIMIT = 120;
export const LABEL_LIMIT = 80;

/** What a poster fills in, on the way in and when they edit it. */
export interface DeadlineFields {
  title: string;
  kind: DeadlineKind;
  due: Date;
  /** Whole percent of the module's grade. 0 means not graded. */
  gradeWeight: number;
}

/** "Not graded" for 0, which is the default: an unsaid weight is not a guessed one. */
export function gradeWeightLabel(weight: number): string {
  return weight > 0 ? `${weight}% of the grade` : 'Not graded';
}

/**
 * A deadline one student has shared with everyone taking the module. Deadlines belong to
 * the **module**, not to one occurrence of a class.
 */
export interface Deadline {
  id: string;
  moduleKey: string;
  /**
   * The class it's due at — a `groupKeyOf` value. Only that class leads with it; every
   * class in the module still lists it. `null` means module-wide.
   */
  atGroupKey: string | null;
  title: string;
  due: Date;
  kind: DeadlineKind;
  /** Who submitted it — the anonymous id used for reports. Empty when read from the server. */
  submitterID: string;
  submittedAt: Date;
  /**
   * Whether this device's owner submitted it, answered by the server so the submitter's id
   * never has to leave it. Null for rows from the local fallback store.
   */
  isMine: boolean | null;
  /** `verified` once a trusted person or the console has confirmed it. */
  status: DeadlineStatus;
  /** When its poster (or an admin) last changed it. */
  editedAt: Date | null;
  /** This student's own name for it, which nobody else sees. */
  myLabel: string | null;
  /** Whole percent of the module's grade; 0 means not graded. */
  gradeWeight: number;
}

export function makeDeadline(fields: {
  id?: string;
  moduleKey: string;
  atGroupKey?: string | null;
  title: string;
  due: Date;
  kind?: DeadlineKind;
  submitterID: string;
  submittedAt?: Date;
  isMine?: boolean | null;
  status?: DeadlineStatus;
  editedAt?: Date | null;
  myLabel?: string | null;
  gradeWeight?: number;
}): Deadline {
  return {
    id: fields.id ?? uuid(),
    moduleKey: fields.moduleKey,
    atGroupKey: fields.atGroupKey ?? null,
    title: fields.title,
    due: fields.due,
    kind: fields.kind ?? 'assignment',
    submitterID: fields.submitterID,
    submittedAt: fields.submittedAt ?? new Date(),
    isMine: fields.isMine ?? null,
    status: fields.status ?? 'pending',
    editedAt: fields.editedAt ?? null,
    myLabel: fields.myLabel ?? null,
    gradeWeight: fields.gradeWeight ?? 0,
  };
}

/** What this student sees it called: their own name for it if they gave one. */
export function displayTitle(deadline: Deadline): string {
  return deadline.myLabel ?? deadline.title;
}

/** Falls back to comparing ids for the local store, which still has them. */
export function deadlineBelongsTo(deadline: Deadline, userID: string): boolean {
  return deadline.isMine ?? deadline.submitterID === userID;
}

/** One student vouching that a deadline is right. */
export interface DeadlineConfirmation {
  deadlineID: string;
  confirmerID: string;
}

export const CONFIRM_THRESHOLD = 3;

/**
 * How much agreement a deadline has, and where this student stands. Each person holds one
 * side at a time: confirming takes back a dispute, and disputing takes back a confirmation.
 */
export class DeadlineStanding {
  constructor(
    readonly confirmCount: number,
    readonly confirmedByMe: boolean,
    readonly disputeCount = 0,
    readonly disputedByMe = false,
  ) {}

  static readonly none = new DeadlineStanding(0, false);

  /** Three vouches, and more of them than people saying it's wrong. */
  get isConfirmed(): boolean {
    return this.confirmCount >= CONFIRM_THRESHOLD && this.confirmCount > this.disputeCount;
  }

  /** At least as many say it's wrong as say it's right — a warning worth more than a tick. */
  get isDisputed(): boolean {
    return this.disputeCount > 0 && this.disputeCount >= this.confirmCount;
  }

  /** Always the real number, never "x of 3". */
  get summary(): string {
    if (this.confirmCount < 1) return 'Nobody has confirmed this yet';
    if (this.confirmCount === 1) return '1 person has confirmed';
    return `${this.confirmCount} people have confirmed`;
  }

  /** Null when nobody disputes it, so the row only grows a line when there's news. */
  get disputeSummary(): string | null {
    if (this.disputeCount < 1) return null;
    if (this.disputeCount === 1) return '1 person says the details are wrong';
    return `${this.disputeCount} people say the details are wrong`;
  }
}

/**
 * The line a row leads its agreement with. A moderator's confirmation sits above the crowd,
 * as a verdict does over cancellation reports: it's a different kind of claim, so it's
 * worded as one rather than shown as a big number.
 */
export type DeadlineTrust = 'verified' | 'disputed' | 'confirmed' | 'unconfirmed';

export function deadlineTrust(deadline: Deadline, standing: DeadlineStanding): DeadlineTrust {
  if (deadline.status === 'verified') return 'verified';
  if (standing.isDisputed) return 'disputed';
  if (standing.isConfirmed) return 'confirmed';
  return 'unconfirmed';
}

/**
 * Why a class is outlined in the timetable. Ordered by how much it matters: a cancelled
 * class outranks a quiz, which outranks something to hand in.
 */
export type ClassHighlight =
  | { kind: 'cancelled'; reportCount: number; decidedBy: string | null }
  | { kind: 'moved'; source: string }
  | { kind: 'test'; title: string }
  | { kind: 'assignment'; title: string };

export function highlightReason(highlight: ClassHighlight): string {
  switch (highlight.kind) {
    case 'cancelled':
      // A verdict rendered as "Reported cancelled · 0 people" reads as nobody thinks it's
      // cancelled — the opposite of what it means.
      if (highlight.decidedBy !== null) return `Cancelled · confirmed by ${highlight.decidedBy}`;
      return `Reported cancelled · ${highlight.reportCount} people`;
    case 'moved': return `Moved · ${highlight.source}`;
    case 'test': return `${highlight.title} today`;
    case 'assignment': return `${highlight.title} due today`;
  }
}

/** "today", "tomorrow", "in 3 days" — counted in whole calendar days between midnights. */
export function deadlineCountdown(due: Date, now: Date = new Date()): string {
  const days = daysBetween(now, due);
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

export const DeadlineRules = {
  confirmThreshold: CONFIRM_THRESHOLD,

  /**
   * Which module's noticeboard a class shares. Falls back to the raw activity code for
   * anything the module code can't be read from.
   */
  moduleKey(event: TimetableEvent): string {
    return event.activity.moduleCode ?? event.activity.raw;
  },

  /**
   * Soonest first, and anything before *today* dropped. Not before this instant: a class is
   * coloured for the whole day a deadline falls on, so dropping an 11am hand-in at 11:01
   * would leave the timetable outlined for something no longer listed.
   */
  upcoming(deadlines: Deadline[], now: Date = new Date()): Deadline[] {
    const floor = DeadlineRules.horizon(now).getTime();
    return deadlines
      .filter((d) => d.due.getTime() >= floor)
      .sort((a, b) => a.due.getTime() - b.due.getTime());
  },

  /** The oldest deadline still worth fetching or showing. */
  horizon(now: Date = new Date()): Date {
    return startOfDay(now);
  },

  /** A submission is only accepted with a real title and a due date in the future. */
  isValid(title: string, due: Date, now: Date = new Date()): boolean {
    const length = title.trim().length;
    return length > 0 && length <= TITLE_LIMIT && due.getTime() > now.getTime();
  },

  /**
   * The weight box, read: blank is 0 (not graded), and anything but a whole number from 0
   * to 100 is null, so the form can refuse it rather than save something else.
   */
  parseGradeWeight(text: string): number | null {
    const trimmed = text.trim().replace(/%$/, '').trim();
    if (trimmed === '') return 0;
    if (!/^\d{1,3}$/.test(trimmed)) return null;
    const value = Number(trimmed);
    return value <= 100 ? value : null;
  },

  /**
   * Whether an edit throws away the confirmations: people vouched for a date and a type,
   * so moving either one means they haven't vouched for this. A reworded title keeps them.
   */
  editClearsConfirmations(deadline: Deadline, kind: DeadlineKind, due: Date): boolean {
    return kind !== deadline.kind || due.getTime() !== deadline.due.getTime();
  },

  /** The name to save: blank, or the shared title itself, means no name of your own. */
  labelToSave(deadline: Deadline, label: string): string | null {
    const trimmed = label.trim().slice(0, LABEL_LIMIT);
    return trimmed.length === 0 || trimmed === deadline.title ? null : trimmed;
  },

  /**
   * Does this deadline belong to this exact class on this exact day? Same module, same
   * calendar day, and either pinned to this class's group or not pinned at all.
   */
  isDue(deadline: Deadline, event: TimetableEvent): boolean {
    if (deadline.moduleKey !== DeadlineRules.moduleKey(event)) return false;
    if (!isSameDay(deadline.due, event.start)) return false;
    if (deadline.atGroupKey === null) return true;
    return deadline.atGroupKey === groupKeyOf(event);
  },

  /** Everything due at this class today, soonest first. */
  dueAt(event: TimetableEvent, deadlines: Deadline[]): Deadline[] {
    return deadlines
      .filter((d) => DeadlineRules.isDue(d, event))
      .sort((a, b) => a.due.getTime() - b.due.getTime());
  },

  /** What (if anything) to outline this class with. */
  highlight(event: TimetableEvent, deadlines: Deadline[], cancellation: CancellationStatus): ClassHighlight | null {
    if (cancellation.isFlagged) {
      return {
        kind: 'cancelled',
        reportCount: cancellation.reportCount,
        decidedBy: cancellation.verdict ? verdictSource(cancellation.verdict) : null,
      };
    }
    // A moved class is still on, so it never reaches the branch above — but turning up to
    // the wrong room needs a warning of its own.
    if (cancellation.verdict?.state === 'moved') {
      return { kind: 'moved', source: verdictSource(cancellation.verdict) };
    }
    const today = DeadlineRules.dueAt(event, deadlines);
    const test = today.find((d) => isSatInClass(d.kind));
    if (test) return { kind: 'test', title: displayTitle(test) };
    if (today.length > 0) return { kind: 'assignment', title: displayTitle(today[0]) };
    return null;
  },

  /**
   * Standings from server-side counts, where the device is told how many vouched and
   * whether it was one of them, but never by whom.
   */
  standingsFromCounts(counts: Map<string, number>, mine: Set<string>): Map<string, DeadlineStanding> {
    const result = new Map<string, DeadlineStanding>();
    for (const [id, count] of counts) result.set(id, new DeadlineStanding(count, mine.has(id)));
    // Vouched by you alone and by nobody else is still a standing worth showing.
    for (const id of mine) {
      if (!result.has(id)) result.set(id, new DeadlineStanding(1, true));
    }
    return result;
  },

  standingsFromConfirmations(confirmations: DeadlineConfirmation[], confirmerID: string): Map<string, DeadlineStanding> {
    const byDeadline = new Map<string, Set<string>>();
    for (const c of confirmations) {
      const set = byDeadline.get(c.deadlineID) ?? new Set<string>();
      set.add(c.confirmerID);
      byDeadline.set(c.deadlineID, set);
    }
    const result = new Map<string, DeadlineStanding>();
    for (const [id, set] of byDeadline) result.set(id, new DeadlineStanding(set.size, set.has(confirmerID)));
    return result;
  },

  countdown: deadlineCountdown,
};

/**
 * Why a student is reporting someone else's deadline. The values are the database's
 * `deadline_reports.reason` check, so they must stay in step with it.
 */
export type DeadlineReportReason = 'offensive' | 'spam' | 'wrong' | 'other';
export const DEADLINE_REPORT_REASONS: DeadlineReportReason[] = ['offensive', 'spam', 'wrong', 'other'];
/**
 * What the Report sheet offers. `wrong` is a dispute with its own button: it's counted in
 * the open and doesn't hide the row, since a wrong date is still one the class should see.
 */
export const ABUSE_REPORT_REASONS: DeadlineReportReason[] = ['offensive', 'spam', 'other'];

export function reportReasonLabel(reason: DeadlineReportReason): string {
  switch (reason) {
    case 'offensive': return 'Offensive or abusive';
    case 'spam': return 'Spam or nonsense';
    case 'wrong': return 'The date or details are wrong';
    case 'other': return 'Something else';
  }
}

// MARK: - The deadlines tab

export type DeadlineSection = 'today' | 'thisWeek' | 'nextWeek' | 'later';
export const DEADLINE_SECTIONS: DeadlineSection[] = ['today', 'thisWeek', 'nextWeek', 'later'];

export function deadlineSectionTitle(section: DeadlineSection): string {
  switch (section) {
    case 'today': return 'Today';
    case 'thisWeek': return 'This week';
    case 'nextWeek': return 'Next week';
    case 'later': return 'Later';
  }
}

export const DeadlineSchedule = {
  /**
   * Weeks run Monday to Sunday here, matching the timetable — a student's "this week" is
   * the teaching week whatever the phone's locale says.
   */
  section(due: Date, now: Date = new Date()): DeadlineSection {
    const today = startOfDay(now);
    const day = startOfDay(due);
    if (day.getTime() <= today.getTime()) return 'today'; // today, and anything the day filter left
    const thisWeekEnd = addDays(startOfWeek(today), 7);
    const nextWeekEnd = addDays(thisWeekEnd, 7);
    if (day.getTime() < thisWeekEnd.getTime()) return 'thisWeek';
    if (day.getTime() < nextWeekEnd.getTime()) return 'nextWeek';
    return 'later';
  },

  /** Soonest first within each bucket, and empty buckets dropped. */
  grouped(deadlines: Deadline[], now: Date = new Date()): { section: DeadlineSection; deadlines: Deadline[] }[] {
    const sorted = DeadlineRules.upcoming(deadlines, now);
    const bySection = new Map<DeadlineSection, Deadline[]>();
    for (const d of sorted) {
      const section = DeadlineSchedule.section(d.due, now);
      bySection.set(section, [...(bySection.get(section) ?? []), d]);
    }
    return DEADLINE_SECTIONS.flatMap((section) => {
      const list = bySection.get(section);
      return list && list.length > 0 ? [{ section, deadlines: list }] : [];
    });
  },

  /** The tests a student sits, split from the things they hand in. */
  sitInClass(deadlines: Deadline[]): Deadline[] {
    return deadlines.filter((d) => isSatInClass(d.kind));
  },
};
