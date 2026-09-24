import {
  Deadline, deadlineBelongsTo, DeadlineReportReason, DeadlineSchedule, DeadlineSection, DeadlineStanding,
} from '../../core/deadline';
import { errorMessage } from '../../data/rest';
import { Services } from '../../data/services';
import { Observable } from '../../state/hooks';

/**
 * Every shared date across every module the student takes. Reads the same store as the
 * class pages, so a deadline added from a lecture appears here and a confirmation given
 * here counts there.
 */
export class DeadlinesModel extends Observable {
  sections: { section: DeadlineSection; deadlines: Deadline[] }[] = [];
  standings = new Map<string, DeadlineStanding>();
  isLoading = false;
  errorText: string | null = null;

  private modules: string[] = [];
  private readonly reporterID: string;

  constructor(private readonly services: Services) {
    super();
    this.reporterID = services.reporter.current;
  }

  get isEmpty(): boolean {
    return this.sections.length === 0;
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

  standing(deadline: Deadline): DeadlineStanding {
    return this.standings.get(deadline.id) ?? DeadlineStanding.none;
  }

  async load(modules: string[]): Promise<void> {
    this.modules = modules;
    if (modules.length === 0) {
      this.sections = [];
      this.changed();
      return;
    }
    this.isLoading = true;
    this.changed();
    try {
      const all = await this.services.deadlines.deadlinesForModules(modules);
      this.sections = DeadlineSchedule.grouped(all);
      this.standings = await this.services.deadlines.standings(all.map((d) => d.id));
      this.errorText = null;
    } catch (error) {
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
    try {
      await work();
    } catch (error) {
      this.errorText = errorMessage(error, fallback);
      this.changed();
    }
    await this.reload();
  }

  toggleConfirmation(deadline: Deadline): Promise<void> {
    return this.act(async () => {
      if (this.standing(deadline).confirmedByMe) await this.services.deadlines.unconfirm(deadline.id, this.reporterID);
      else await this.services.deadlines.confirm(deadline.id, this.reporterID);
    }, "Couldn't send that.");
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
