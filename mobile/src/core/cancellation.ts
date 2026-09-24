import { isoSeconds } from './time';
import { TimetableEvent } from './timetableEvent';

// MARK: - Verdicts

/** What a trusted person has stated about one occurrence of a class. */
export type VerdictState = 'cancelled' | 'running' | 'moved';
export const VERDICT_STATES: VerdictState[] = ['cancelled', 'running', 'moved'];

/**
 * One definitive statement about a class, outranking any number of student reports.
 *
 * This is a different kind of claim from a tally, not a louder one, and the UI must keep
 * them apart: "3 people say this is cancelled" is a guess with weight behind it,
 * "confirmed cancelled" is a fact with someone's name behind it.
 */
export interface EventVerdict {
  /** Must equal `CancellationRules.eventKey` exactly — see docs/ADMIN_CONSOLE.md §6. */
  eventKey: string;
  state: VerdictState;
  note?: string | null;
  roomOverride?: string | null;
  startOverride?: Date | null;
  /** What students see as the source — "the class rep", "Dr Ryan's email". */
  decidedByLabel?: string | null;
  decidedAt?: Date;
}

/**
 * "an organiser" rather than nothing: an unattributed verdict still needs to read as
 * coming from a person, or a student can't weigh it at all.
 */
export function verdictSource(verdict: EventVerdict): string {
  const trimmed = verdict.decidedByLabel?.trim();
  return trimmed ? trimmed : 'an organiser';
}

export function verdictHeadline(verdict: EventVerdict): string {
  const source = verdictSource(verdict);
  switch (verdict.state) {
    case 'cancelled': return `Confirmed cancelled by ${source}`;
    case 'running': return `Confirmed on by ${source}`;
    case 'moved': return `Moved by ${source}`;
  }
}

// MARK: - Reports

/**
 * Which way a student voted on one occurrence of a class. Disagreement is a first-class
 * answer, not the absence of a report.
 */
export type ReportStance = 'cancelled' | 'on';

export function isReportStance(value: unknown): value is ReportStance {
  return value === 'cancelled' || value === 'on';
}

/** One student's report about whether a class ran. */
export interface CancellationReport {
  eventKey: string;
  /** Anonymous per-install id — used only to stop one device counting several times. */
  reporterID: string;
  stance: ReportStance;
  reportedAt: Date;
}

export function makeReport(
  eventKey: string,
  reporterID: string,
  stance: ReportStance = 'cancelled',
  reportedAt: Date = new Date(),
): CancellationReport {
  return { eventKey, reporterID, stance, reportedAt };
}

/**
 * How many people reported a class each way, counted by the server rather than on the
 * device (see `supabase/phase3_anonymity.sql`).
 */
export interface CancellationTally {
  eventKey: string;
  reportCount: number;
  onCount: number;
  myStance: ReportStance | null;
}

export const CANCELLATION_THRESHOLD = 3;
/**
 * How far ahead the cancellation reports must stay once contradictions are subtracted.
 * Lower than the threshold on purpose: reaching three reports is the hard part, and
 * demanding a clear three after subtraction would let a single mistaken "it was on" bury
 * a real cancellation.
 */
export const CANCELLATION_NET_THRESHOLD = 2;

/**
 * What is known about whether a class is on: what the crowd says, how this person voted,
 * and any definitive verdict that outranks both.
 */
export class CancellationStatus {
  constructor(
    /** People who reported the class cancelled. */
    readonly reportCount: number,
    /** People who reported it went ahead anyway. */
    readonly onCount: number = 0,
    readonly myStance: ReportStance | null = null,
    /** A trusted person's statement. When present it decides the outcome. */
    readonly verdict: EventVerdict | null = null,
  ) {}

  static readonly none = new CancellationStatus(0);

  get reportedByMe(): boolean {
    return this.myStance === 'cancelled';
  }

  /**
   * Precedence: a verdict, then the crowd, then nothing.
   *
   * `running` deliberately returns false even with a hundred reports behind it — that is
   * the entire purpose of a running verdict.
   *
   * The crowd has to clear two bars. The threshold is the evidence bar (three people said
   * cancelled), never netted, so a contradiction can never make a class *easier* to flag.
   * The net threshold is the agreement bar, applied once the people who walked into a
   * running lecture are subtracted. So 3–0 and 4–1 flag; 3–2 does not.
   */
  get isFlagged(): boolean {
    switch (this.verdict?.state) {
      case 'cancelled': return true;
      case 'running': return false;
      case 'moved': return false;
      default:
        return this.reportCount >= CANCELLATION_THRESHOLD
          && this.netReports >= CANCELLATION_NET_THRESHOLD;
    }
  }

  /** Cancellation reports less the people who contradicted them, floored at zero. */
  get netReports(): number {
    return Math.max(0, this.reportCount - this.onCount);
  }

  /** On, but not where or when the timetable says. */
  get isMoved(): boolean {
    return this.verdict?.state === 'moved';
  }

  /** Whether the claim is someone's stated fact rather than a tally of guesses. */
  get isDecided(): boolean {
    return this.verdict !== null;
  }

  /** Always the real number, never "x of 3". */
  get summary(): string {
    if (this.verdict) return verdictHeadline(this.verdict);
    if (this.reportCount < 1) return 'Nobody has reported this class as cancelled';
    if (this.reportCount === 1) return '1 person says this is cancelled';
    return `${this.reportCount} people say this is cancelled`;
  }

  /** What the crowd said, shown *underneath* a verdict rather than instead of it. */
  get crowdSummary(): string | null {
    if (this.verdict === null || this.reportCount <= 0) return null;
    return this.reportCount === 1
      ? '1 person had reported this as cancelled'
      : `${this.reportCount} people had reported this as cancelled`;
  }

  /** This student's own report, stated back to them. */
  get myReportLine(): string | null {
    switch (this.myStance) {
      case 'cancelled': return 'You reported cancelled';
      case 'on': return 'You reported this class went ahead';
      default: return null;
    }
  }

  /**
   * Everyone else who said it was cancelled. Counts *others*, so it never includes the
   * reader — otherwise it overstates the evidence by one.
   */
  get othersLine(): string | null {
    const others = this.myStance === 'cancelled' ? this.reportCount - 1 : this.reportCount;
    if (others <= 0) return null;
    if (this.myStance === null) {
      return others === 1 ? '1 person has reported cancelled' : `${others} people have reported cancelled`;
    }
    return others === 1 ? '1 other has reported cancelled' : `${others} others have reported cancelled`;
  }

  /** People contradicting the cancellation reports, when there is something to contradict. */
  get disputedLine(): string | null {
    if (this.onCount <= 0 || this.reportCount <= 0) return null;
    return this.onCount === 1 ? '1 person says it went ahead' : `${this.onCount} people say it went ahead`;
  }
}

export const CancellationRules = {
  threshold: CANCELLATION_THRESHOLD,
  netThreshold: CANCELLATION_NET_THRESHOLD,

  /**
   * A stable id for one occurrence of a class, identical on every student's device: the
   * activity code and the exact start time in UTC, e.g.
   * `EEG1006[1]OC/L1/01|2026-09-16T09:00:00Z`. The API's own event identity is not
   * guaranteed stable between queries, so it isn't used.
   */
  eventKey(event: TimetableEvent): string {
    return `${event.activity.raw}|${isoSeconds(event.start)}`;
  },

  /** Tally reports for one class. Repeat reports from the same device count once. */
  status(
    key: string,
    reports: CancellationReport[],
    reporterID: string,
    verdict: EventVerdict | null = null,
  ): CancellationStatus {
    return (
      CancellationRules.statusesFromReports(
        reports.filter((r) => r.eventKey === key),
        reporterID,
        verdict ? [verdict] : [],
      ).get(key) ?? new CancellationStatus(0, 0, null, verdict)
    );
  },

  /** Build statuses from server-side tallies. */
  statusesFromTallies(
    tallies: CancellationTally[],
    verdicts: EventVerdict[] = [],
  ): Map<string, CancellationStatus> {
    const byKey = firstByKey(verdicts);
    const result = new Map<string, CancellationStatus>();
    for (const tally of tallies) {
      result.set(
        tally.eventKey,
        new CancellationStatus(tally.reportCount, tally.onCount, tally.myStance, byKey.get(tally.eventKey) ?? null),
      );
    }
    // A verdict on a class nobody reported has no tally row to decorate.
    for (const [key, verdict] of byKey) {
      if (!result.has(key)) result.set(key, new CancellationStatus(0, 0, null, verdict));
    }
    return result;
  },

  statusesFromReports(
    reports: CancellationReport[],
    reporterID: string,
    verdicts: EventVerdict[] = [],
  ): Map<string, CancellationStatus> {
    // One vote per person per class, on whichever side they last claimed.
    const byKey = new Map<string, Map<string, ReportStance>>();
    const ordered = [...reports].sort((a, b) => a.reportedAt.getTime() - b.reportedAt.getTime());
    for (const report of ordered) {
      const votes = byKey.get(report.eventKey) ?? new Map<string, ReportStance>();
      votes.set(report.reporterID, report.stance);
      byKey.set(report.eventKey, votes);
    }

    const result = new Map<string, CancellationStatus>();
    for (const [key, votes] of byKey) {
      const stances = [...votes.values()];
      result.set(
        key,
        new CancellationStatus(
          stances.filter((s) => s === 'cancelled').length,
          stances.filter((s) => s === 'on').length,
          votes.get(reporterID) ?? null,
          null,
        ),
      );
    }
    // A verdict on a class nobody reported still has to appear.
    for (const [key, verdict] of firstByKey(verdicts)) {
      const existing = result.get(key);
      result.set(
        key,
        new CancellationStatus(existing?.reportCount ?? 0, existing?.onCount ?? 0, existing?.myStance ?? null, verdict),
      );
    }
    return result;
  },
};

/** Duplicate keys keep the first rather than failing — the survivable answer. */
function firstByKey(verdicts: EventVerdict[]): Map<string, EventVerdict> {
  const map = new Map<string, EventVerdict>();
  for (const verdict of verdicts) {
    if (!map.has(verdict.eventKey)) map.set(verdict.eventKey, verdict);
  }
  return map;
}
