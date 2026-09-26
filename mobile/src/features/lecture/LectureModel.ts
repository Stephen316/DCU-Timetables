import { CancellationRules, CancellationStatus, makeReport, ReportStance, VerdictState } from '../../core/cancellation';
import {
  Deadline, deadlineBelongsTo, DeadlineKind, DeadlineReportReason, DeadlineRules, DeadlineStanding, makeDeadline,
} from '../../core/deadline';
import { AccountRules, Roles } from '../../core/identity';
import { Lecturer } from '../../core/misc';
import { lecturerDirectory } from '../../data/timetable';
import { groupKeyOf, TimetableEvent } from '../../core/timetableEvent';
import { errorMessage } from '../../data/rest';
import { Services } from '../../data/services';
import { Observable } from '../../state/hooks';

/** Everything known about one class: the crowd, any verdict, and the module's deadlines. */
export class LectureModel extends Observable {
  status = CancellationStatus.none;
  deadlines: Deadline[];
  standings = new Map<string, DeadlineStanding>();
  isLoading = false;
  isBusy = false;
  errorText: string | null = null;
  /**
   * Whether this person may decide rather than vote. A cached hint, refreshed on load —
   * the database enforces it, so a stale `true` can only offer a button that comes back 403.
   */
  canDecide: boolean;
  readonly lecturers: Lecturer[];

  private readonly reporterID: string;

  constructor(private readonly services: Services, readonly event: TimetableEvent, known: Deadline[] = []) {
    super();
    this.reporterID = services.reporter.current;
    this.canDecide = Roles.canDecide(services.role.current);
    this.lecturers = lecturerDirectory.lecturersFor(event);
    // Seeded from the timetable's own copy so the page opens with its banner already drawn.
    this.deadlines = DeadlineRules.upcoming(known.filter((d) => d.moduleKey === this.moduleKey));
  }

  get eventKey(): string {
    return CancellationRules.eventKey(this.event);
  }

  get moduleKey(): string {
    return DeadlineRules.moduleKey(this.event);
  }

  /** Everything due at *this* class today — the banner at the top of the page. */
  get dueHere(): Deadline[] {
    return DeadlineRules.dueAt(this.event, this.deadlines);
  }

  isMine(deadline: Deadline): boolean {
    return deadlineBelongsTo(deadline, this.reporterID);
  }

  standing(deadline: Deadline): DeadlineStanding {
    return this.standings.get(deadline.id) ?? DeadlineStanding.none;
  }

  async load(): Promise<void> {
    this.isLoading = true;
    this.changed();
    const { cancellations, verdicts, profiles, deadlines, role } = this.services;
    const verdict = (await verdicts.verdicts([this.eventKey]).catch(() => []))[0] ?? null;
    const tally = (await cancellations.tallies([this.eventKey]).catch(() => []))[0];
    // No tally row means nobody has voted — including this student, whose report would
    // have made one. Resetting is what makes "Undo my report" disappear after a withdrawal,
    // and a verdict still shows when the report fetch failed.
    this.status = tally
      ? new CancellationStatus(tally.reportCount, tally.onCount, tally.myStance, verdict)
      : new CancellationStatus(0, 0, null, verdict);

    const profile = await profiles.myProfile().catch(() => null);
    if (profile) {
      role.save(profile.role);
      this.canDecide = AccountRules.canDecide(profile);
    }
    try {
      this.deadlines = DeadlineRules.upcoming(await deadlines.deadlinesForModule(this.moduleKey));
      this.standings = await deadlines.standings(this.deadlines.map((d) => d.id)).catch(() => this.standings);
    } catch {
      // Keep the seeded list.
    }
    this.isLoading = false;
    this.changed();
  }

  private async busy(work: () => Promise<void>, fallback: string, reload = true): Promise<void> {
    this.isBusy = true;
    this.changed();
    try {
      await work();
      if (reload) await this.load();
    } catch (error) {
      this.errorText = errorMessage(error, fallback);
    }
    this.isBusy = false;
    this.changed();
  }

  /** Vouching for someone else's deadline, or taking that back. */
  toggleConfirmation(deadline: Deadline): Promise<void> {
    return this.busy(async () => {
      if (this.standing(deadline).confirmedByMe) await this.services.deadlines.unconfirm(deadline.id, this.reporterID);
      else await this.services.deadlines.confirm(deadline.id, this.reporterID);
    }, "Couldn't send that.");
  }

  /** Post a definitive verdict. The database refuses it for anyone who isn't trusted. */
  async decide(state: VerdictState): Promise<void> {
    const userID = this.services.user.current?.id;
    if (!userID) return;
    await this.busy(
      () => this.services.verdicts.set({ eventKey: this.eventKey, state }, this.moduleKey, userID),
      "Couldn't post that.",
    );
  }

  /**
   * Record this student's view of whether the class ran. Switching sides deletes the old
   * row first: the insert is ON CONFLICT DO NOTHING, so posting `on` over your own
   * `cancelled` would otherwise succeed and change nothing.
   */
  report(stance: ReportStance): Promise<void> {
    return this.busy(async () => {
      if (this.status.myStance !== null) await this.services.cancellations.withdraw(this.eventKey, this.reporterID);
      await this.services.cancellations.submit(makeReport(this.eventKey, this.reporterID, stance));
    }, "Couldn't send that report.");
  }

  /** Take back whichever way this student voted. */
  async withdrawReport(): Promise<void> {
    if (this.status.myStance === null) return;
    await this.busy(() => this.services.cancellations.withdraw(this.eventKey, this.reporterID), "Couldn't undo that report.");
  }

  async addDeadline(title: string, kind: DeadlineKind, due: Date): Promise<void> {
    if (!DeadlineRules.isValid(title, due)) return;
    // Pinned to this class, so only this lecture or practical leads with it.
    const deadline = makeDeadline({
      moduleKey: this.moduleKey, atGroupKey: groupKeyOf(this.event), title, due, kind, submitterID: this.reporterID, isMine: true,
    });
    // Show it straight away; the reload confirms it landed.
    this.deadlines = DeadlineRules.upcoming([...this.deadlines, deadline]);
    this.changed();
    try {
      await this.services.deadlines.submit(deadline);
      // Submitting is itself a vouch — otherwise a first-hand report reads "0 confirmed".
      await this.services.deadlines.confirm(deadline.id, this.reporterID).catch(() => undefined);
    } catch (error) {
      this.errorText = errorMessage(error, "Couldn't share that deadline.");
    }
    await this.load();
  }

  async removeDeadline(deadline: Deadline): Promise<void> {
    if (!this.isMine(deadline)) return;
    await this.dropThen(deadline, () => this.services.deadlines.withdraw(deadline.id, this.reporterID), "Couldn't remove that deadline.");
  }

  /** Off the page at once; the server keeps it off on every later load. */
  async reportDeadline(deadline: Deadline, reason: DeadlineReportReason): Promise<void> {
    if (this.isMine(deadline)) return;
    await this.dropThen(deadline, () => this.services.deadlines.report(deadline.id, reason), "Couldn't send that report.");
  }

  /** Which other rows go with it is only known to the server, so this reloads. */
  async hideAuthor(deadline: Deadline): Promise<void> {
    if (this.isMine(deadline)) return;
    await this.dropThen(deadline, () => this.services.deadlines.hideAuthor(deadline.id), "Couldn't hide that person.");
  }

  private async dropThen(deadline: Deadline, work: () => Promise<void>, fallback: string): Promise<void> {
    this.deadlines = this.deadlines.filter((d) => d.id !== deadline.id);
    this.changed();
    try {
      await work();
    } catch (error) {
      // Say so rather than letting the reload quietly put the row back.
      this.errorText = errorMessage(error, fallback);
    }
    await this.load();
  }
}
