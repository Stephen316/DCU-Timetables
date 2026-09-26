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
  };
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

/** How much agreement a deadline has, and whether this student is part of it. */
export class DeadlineStanding {
  constructor(readonly confirmCount: number, readonly confirmedByMe: boolean) {}

  static readonly none = new DeadlineStanding(0, false);

  get isConfirmed(): boolean {
    return this.confirmCount >= CONFIRM_THRESHOLD;
  }

  /** Always the real number, never "x of 3". */
  get summary(): string {
    if (this.confirmCount < 1) return 'Nobody has confirmed this yet';
    if (this.confirmCount === 1) return '1 person has confirmed';
    return `${this.confirmCount} people have confirmed`;
  }
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
    return title.trim().length > 0 && due.getTime() > now.getTime();
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
    if (test) return { kind: 'test', title: test.title };
    if (today.length > 0) return { kind: 'assignment', title: today[0].title };
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
