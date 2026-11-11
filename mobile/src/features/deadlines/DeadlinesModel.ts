import {
  Deadline, deadlineBelongsTo, DeadlineFields, DeadlinePlacement, DeadlineReportReason, DeadlineRules, DeadlineSchedule,
  DeadlineSection, DeadlineStanding, makeDeadline,
} from '../../core/deadline';
import { errorMessage } from '../../data/rest';
import { Services } from '../../data/services';
import { Observable } from '../../state/hooks';
import { DetailsEdits } from './DetailsEdits';
import { CompletedDeadlines } from './Completed';
import { canEdit, Moderation, moderationFor } from './Moderation';

/**
 * Posting a new deadline, from a class page or this tab. Submitting is itself a vouch —
 * otherwise a first-hand report reads "0 confirmed".
 */
export async function shareDeadline(services: Services, deadline: Deadline, reporterID: string): Promise<void> {
  await services.deadlines.submit(deadline);
  await services.deadlines.confirm(deadline.id, reporterID).catch(() => undefined);
}

/**
 * Every shared date across every module the student takes. Reads the same store as the
 * class pages, so a deadline added from a lecture appears here and a confirmation given
 * here counts there.
 */
export class DeadlinesModel extends Observable {
  sections: { section: DeadlineSection; deadlines: Deadline[] }[] = [];
  /**
   * Gone by, back `PAST_DEADLINE_DAYS`, most recent first, for the module being shown:
   * Completed's Past list. Ticked or not — its day is over either way.
   */
  past: Deadline[] = [];
  /** The one module being shown, or null for every module. */
  moduleFilter: string | null = null;
  standings = new Map<string, DeadlineStanding>();
  isLoading = false;
  errorText: string | null = null;
  /**
   * The deadline this student added last, for the list to bring into view: a long list
   * would otherwise take it in below the fold, and closing the form looks like nothing happened.
   */
  justAdded: string | null = null;

  private modules: string[] = [];
  /**
   * Bumped by each load. The module list grows as the timetable's weeks arrive, so loads
   * overlap, and an older answer landing last would put back a shorter list.
   */
  private loadRequest = 0;
  private all: Deadline[] = [];
  private allPast: Deadline[] = [];
  private readonly reporterID: string;

  readonly details: DetailsEdits;
  private readonly completed: CompletedDeadlines;
  /** A moderator confirms deadlines for everyone; only an admin may edit someone else's. */
  readonly moderation: Moderation;

  constructor(private readonly services: Services) {
    super();
    this.reporterID = services.reporter.current;
    this.completed = new CompletedDeadlines(services.prefs);
    this.moderation = moderationFor(services.role.current);
    this.details = new DetailsEdits(services, {
      replace: (deadline) => {
        this.all = this.all.map((d) => (d.id === deadline.id ? deadline : d));
        this.allPast = this.allPast.map((d) => (d.id === deadline.id ? deadline : d));
        this.regroup();
      },
      changed: () => this.changed(),
    });
  }

  /** Nothing coming and nothing recent: a student whose last deadline just passed still gets the tabs. */
  get isEmpty(): boolean {
    return this.sections.length === 0 && this.past.length === 0;
  }

  /** The modules that have something coming up — the choices for `moduleFilter`. */
  get modulesWithDeadlines(): string[] {
    return [...new Set(DeadlineRules.upcoming(this.all).map((d) => d.moduleKey))];
  }

  showModule(key: string | null): void {
    this.moduleFilter = key;
    this.regroup();
    this.changed();
  }

  private regroup(): void {
    // A module whose last deadline has passed or gone would leave an empty page with no way
    // back but the menu, so the filter lets go of it.
    if (this.moduleFilter && !this.modulesWithDeadlines.includes(this.moduleFilter)) this.moduleFilter = null;
    const shown = this.moduleFilter ? this.all.filter((d) => d.moduleKey === this.moduleFilter) : this.all;
    this.sections = DeadlineSchedule.grouped(shown);
    const pastShown = this.moduleFilter ? this.allPast.filter((d) => d.moduleKey === this.moduleFilter) : this.allPast;
    this.past = DeadlineRules.recentlyPast(pastShown);
  }

  get total(): number {
    return this.sections.reduce((n, s) => n + s.deadlines.length, 0);
  }

  /** What's sat in a room rather than handed in — the half that can't be made up afterwards. */
  get testCount(): number {
    return DeadlineSchedule.sitInClass(this.sections.flatMap((s) => s.deadlines)).length;
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
    this.services.events.emit('deadlinesChanged');
  }

  standing(deadline: Deadline): DeadlineStanding {
    return this.standings.get(deadline.id) ?? DeadlineStanding.none;
  }

  /**
   * Fetches the deadlines for `modules`. `known` is what the timetable already fetched for
   * them — its outlines need the same deadlines — and fills an empty tab while this asks, so
   * the tab never sits on a spinner for a list the app already has.
   */
  async load(modules: string[], known: Deadline[] = []): Promise<void> {
    const request = ++this.loadRequest;
    this.modules = modules;
    if (modules.length === 0) {
      this.all = [];
      this.allPast = [];
      this.regroup();
      this.changed();
      return;
    }
    if (this.all.length === 0 && known.length > 0) {
      const wanted = new Set(modules);
      this.all = known.filter((d) => wanted.has(d.moduleKey));
      this.regroup();
    }
    this.isLoading = true;
    this.changed();
    try {
      // Past is asked for alongside, and a failure there only keeps the Past list it had:
      // what's still to hand in matters more than what's gone.
      const [all, past] = await Promise.all([
        this.services.deadlines.deadlinesForModules(modules),
        this.services.deadlines.pastDeadlinesForModules(modules).catch(() => null),
      ]);
      if (request !== this.loadRequest) return;
      this.all = all;
      if (past) this.allPast = past;
      this.regroup();
      // The list is shown now; how many confirmed each one fills in when it comes.
      this.changed();
      const standings = await this.services.deadlines.standings([...all, ...this.allPast].map((d) => d.id));
      if (request !== this.loadRequest) return;
      this.standings = standings;
      this.errorText = null;
    } catch (error) {
      if (request !== this.loadRequest) return;
      // Keep whatever is on screen: a stale list beats an empty one when only the network is wrong.
      this.errorText = errorMessage(error, "Couldn't load deadlines.");
    }
    this.isLoading = false;
    this.changed();
  }

  reload(): Promise<void> {
    return this.load(this.modules);
  }

  private async act(work: () => Promise<void>, fallback: string): Promise<void> {
    let failure: string | null = null;
    try {
      await work();
    } catch (error) {
      failure = errorMessage(error, fallback);
      this.errorText = failure;
      this.changed();
    }
    await this.reload();
    this.keepError(failure);
    this.services.events.emit('deadlinesChanged');
  }

  /**
   * Puts back what went wrong once the reload after it is in. A reload that works clears
   * the message, which would otherwise wipe it the moment it appeared.
   */
  private keepError(failure: string | null): void {
    if (!failure || this.errorText) return;
    this.errorText = failure;
    this.changed();
  }

  toggleConfirmation(deadline: Deadline): Promise<void> {
    return this.act(async () => {
      if (this.standing(deadline).confirmedByMe) await this.services.deadlines.unconfirm(deadline.id, this.reporterID);
      else await this.services.deadlines.confirm(deadline.id, this.reporterID);
    }, "Couldn't send that.");
  }

  /** "The details are wrong", or taking that back. The server withdraws a confirmation it replaces. */
  toggleDispute(deadline: Deadline): Promise<void> {
    if (this.isMine(deadline)) return Promise.resolve();
    return this.act(async () => {
      if (this.standing(deadline).disputedByMe) await this.services.deadlines.withdrawReport(deadline.id);
      else await this.services.deadlines.report(deadline.id, 'wrong');
    }, "Couldn't send that.");
  }

  /**
   * A new one, for whichever of the student's modules they picked. In the list at once; the
   * reload confirms it landed. Their own name for it, and any details, go on once the row exists.
   */
  async add(fields: DeadlineFields, placement: DeadlinePlacement, details = ''): Promise<void> {
    if (!DeadlineRules.isValid(fields.title, fields.due) || DeadlineRules.detailsProblem(details)) return;
    const deadline = makeDeadline({
      moduleKey: placement.moduleKey, atGroupKey: placement.atGroupKey, ...fields, submitterID: this.reporterID, isMine: true,
      details: details.trim(), detailsEditedAt: details.trim() ? new Date() : null,
    });
    this.all = DeadlineRules.upcoming([...this.all, deadline]);
    // Showing another module would save it out of sight, as if adding it had failed.
    if (this.moduleFilter && this.moduleFilter !== deadline.moduleKey) this.moduleFilter = null;
    this.justAdded = deadline.id;
    this.regroup();
    this.changed();
    try {
      await shareDeadline(this.services, deadline, this.reporterID);
    } catch (error) {
      this.justAdded = null;
      const failure = errorMessage(error, "Couldn't share that deadline.");
      this.errorText = failure;
      await this.reload();
      this.keepError(failure);
      return;
    }
    const label = DeadlineRules.labelToSave(deadline, placement.label);
    await this.act(async () => {
      if (label) await this.services.deadlines.setLabel(deadline.id, label);
      if (deadline.details) await this.services.deadlines.setDetails(deadline.id, deadline.details);
    }, 'Shared, but your name for it or the details didn\'t save.');
  }

  /**
   * The poster's fields, then the details if they changed: one reload, once all of it has
   * landed. A moderator's edit confirms it too — they've just checked every field.
   */
  async edit(deadline: Deadline, fields: DeadlineFields, details: string = deadline.details): Promise<void> {
    if (!canEdit(this.moderation, this.isMine(deadline))) return;
    if (!DeadlineRules.isValid(fields.title, fields.due) || DeadlineRules.detailsProblem(details)) return;
    await this.act(async () => {
      await this.services.deadlines.edit(deadline.id, fields);
      if (details.trim() !== deadline.details) await this.services.deadlines.setDetails(deadline.id, details.trim());
      if (this.moderation.canVerify) await this.services.deadlines.verify(deadline.id, true);
    }, "Couldn't save that change.");
  }

  /** A moderator's Confirm, or tapping it again to take it back. */
  async toggleVerified(deadline: Deadline): Promise<void> {
    if (!this.moderation.canVerify) return;
    await this.act(() => this.services.deadlines.verify(deadline.id, deadline.status !== 'verified'), "Couldn't confirm that.");
  }

  /** Only this student sees the name. */
  async rename(deadline: Deadline, label: string): Promise<void> {
    await this.act(
      () => this.services.deadlines.setLabel(deadline.id, DeadlineRules.labelToSave(deadline, label)),
      "Couldn't rename that.",
    );
  }

  async remove(deadline: Deadline): Promise<void> {
    if (!this.isMine(deadline)) return;
    await this.act(() => this.services.deadlines.withdraw(deadline.id, this.reporterID), "Couldn't remove that deadline.");
  }

  async report(deadline: Deadline, reason: DeadlineReportReason): Promise<void> {
    if (this.isMine(deadline)) return;
    await this.act(() => this.services.deadlines.report(deadline.id, reason), "Couldn't send that report.");
  }

  async hideAuthor(deadline: Deadline): Promise<void> {
    if (this.isMine(deadline)) return;
    await this.act(() => this.services.deadlines.hideAuthor(deadline.id), "Couldn't hide that person.");
  }
}
