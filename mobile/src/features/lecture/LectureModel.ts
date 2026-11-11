import { CancellationRules, CancellationStatus, makeReport, ReportStance, VerdictState } from '../../core/cancellation';
import {
  Deadline, deadlineBelongsTo, DeadlineFields, DeadlineReportReason, DeadlineRules, DeadlineStanding, makeDeadline,
} from '../../core/deadline';
import { AccountRules, Roles } from '../../core/identity';
import { Lecturer } from '../../core/misc';
import { lecturerDirectory } from '../../data/timetable';
import { groupKeyOf, TimetableEvent } from '../../core/timetableEvent';
import { errorMessage } from '../../data/rest';
import { Services } from '../../data/services';
import { Observable } from '../../state/hooks';
import { shareDeadline } from '../deadlines/DeadlinesModel';
import { DetailsEdits } from '../deadlines/DetailsEdits';
import { CompletedDeadlines } from '../deadlines/Completed';
import { canEdit, Moderation, moderationFor } from '../deadlines/Moderation';

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
  /**
   * The tutorial's practice run: a report changes what this page shows and nothing else —
   * no request, so no classmate sees a class flagged by someone learning the app.
   */
  practice = false;

  setPractice(practice: boolean): void {
    // The tour ending on this page (skipped, say) takes its pretend report with it, or the
    // page goes on showing it and a real report or undo afterwards acts on it.
    const ended = this.practice && !practice && this.beforePractice !== null;
    this.practice = practice;
    if (ended && this.beforePractice) {
      this.status = this.beforePractice;
      this.beforePractice = null;
      this.changed();
    }
  }

  private readonly reporterID: string;
  /** What the page showed before a practice report, put back when it's undone. */
  private beforePractice: CancellationStatus | null = null;

  readonly details: DetailsEdits;
  private readonly completed: CompletedDeadlines;
  /** A moderator confirms deadlines for everyone; only an admin may edit someone else's. */
  moderation: Moderation;

  constructor(private readonly services: Services, readonly event: TimetableEvent, known: Deadline[] = []) {
    super();
    this.reporterID = services.reporter.current;
    this.completed = new CompletedDeadlines(services.prefs);
    this.details = new DetailsEdits(services, {
      replace: (deadline) => {
        this.deadlines = this.deadlines.map((d) => (d.id === deadline.id ? deadline : d));
      },
      changed: () => this.changed(),
    });
    this.canDecide = Roles.canDecide(services.role.current);
    this.moderation = moderationFor(services.role.current);
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

  /** Ticked off by this student, on this device. */
  isCompleted(deadline: Deadline): boolean {
    return this.completed.has(deadline.id);
  }

  toggleCompleted(deadline: Deadline): void {
    this.completed.toggle(deadline.id);
    this.changed();
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
      this.moderation = moderationFor(AccountRules.isBanned(profile) ? 'student' : profile.role);
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
    // A new try starts clean: an old failure left up reads as this one failing too.
    this.errorText = null;
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
    // The tutorial's practice: a moderator's verdict decides everyone's timetable, so in the
    // tour it's only shown here. Marking it on again puts back what was there.
    if (this.practice) {
      if (state === 'running' && this.beforePractice) {
        this.status = this.beforePractice;
        this.beforePractice = null;
      } else {
        const s = this.status;
        this.beforePractice ??= s;
        this.status = new CancellationStatus(s.reportCount, s.onCount, s.myStance, { eventKey: this.eventKey, state });
      }
      this.changed();
      return;
    }
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
    if (this.practice) {
      const s = this.status;
      this.beforePractice ??= s;
      this.status = new CancellationStatus(
        s.reportCount + (stance === 'cancelled' ? 1 : 0), s.onCount + (stance === 'on' ? 1 : 0), stance, s.verdict,
      );
      this.changed();
      return Promise.resolve();
    }
    return this.busy(async () => {
      if (this.status.myStance !== null) await this.services.cancellations.withdraw(this.eventKey, this.reporterID);
      await this.services.cancellations.submit(makeReport(this.eventKey, this.reporterID, stance));
    }, "Couldn't send that report.");
  }

  /** Take back whichever way this student voted. */
  async withdrawReport(): Promise<void> {
    if (this.beforePractice) {
      this.status = this.beforePractice;
      this.beforePractice = null;
      this.changed();
      return;
    }
    if (this.status.myStance === null) return;
    await this.busy(() => this.services.cancellations.withdraw(this.eventKey, this.reporterID), "Couldn't undo that report.");
  }

  async addDeadline(fields: DeadlineFields, details = ''): Promise<void> {
    if (!DeadlineRules.isValid(fields.title, fields.due) || DeadlineRules.detailsProblem(details)) return;
    // Pinned to this class, so only this lecture or practical leads with it.
    const deadline = makeDeadline({
      moduleKey: this.moduleKey, atGroupKey: groupKeyOf(this.event), ...fields, submitterID: this.reporterID, isMine: true,
      details: details.trim(), detailsEditedAt: details.trim() ? new Date() : null,
    });
    // Show it straight away; the reload confirms it landed.
    this.deadlines = DeadlineRules.upcoming([...this.deadlines, deadline]);
    this.errorText = null;
    this.changed();
    try {
      await shareDeadline(this.services, deadline, this.reporterID);
      try {
        if (deadline.details) await this.services.deadlines.setDetails(deadline.id, deadline.details);
      } catch (error) {
        this.errorText = errorMessage(error, "Shared, but the details didn't save.");
      }
    } catch (error) {
      this.errorText = errorMessage(error, "Couldn't share that deadline.");
    }
    await this.load();
  }

  /** "The details are wrong", or taking that back. It stays on the page either way. */
  toggleDispute(deadline: Deadline): Promise<void> {
    if (this.isMine(deadline)) return Promise.resolve();
    return this.busy(async () => {
      if (this.standing(deadline).disputedByMe) await this.services.deadlines.withdrawReport(deadline.id);
      else await this.services.deadlines.report(deadline.id, 'wrong');
    }, "Couldn't send that.");
  }

  /** The poster's fields, then the details if they changed. A moderator's edit confirms it too. */
  async editDeadline(deadline: Deadline, fields: DeadlineFields, details: string = deadline.details): Promise<void> {
    if (!canEdit(this.moderation, this.isMine(deadline))) return;
    if (!DeadlineRules.isValid(fields.title, fields.due) || DeadlineRules.detailsProblem(details)) return;
    await this.busy(async () => {
      await this.services.deadlines.edit(deadline.id, fields);
      if (details.trim() !== deadline.details) await this.services.deadlines.setDetails(deadline.id, details.trim());
      if (this.moderation.canVerify) await this.services.deadlines.verify(deadline.id, true);
    }, "Couldn't save that change.");
  }

  /** A moderator's Confirm, or tapping it again to take it back. */
  async toggleVerified(deadline: Deadline): Promise<void> {
    if (!this.moderation.canVerify) return;
    await this.busy(() => this.services.deadlines.verify(deadline.id, deadline.status !== 'verified'), "Couldn't confirm that.");
  }

  /** Only this student sees the name. */
  async renameDeadline(deadline: Deadline, label: string): Promise<void> {
    await this.busy(
      () => this.services.deadlines.setLabel(deadline.id, DeadlineRules.labelToSave(deadline, label)),
      "Couldn't rename that.",
    );
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
    this.errorText = null;
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
