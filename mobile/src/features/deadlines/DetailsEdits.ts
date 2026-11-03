import { Deadline, DeadlineRules } from '../../core/deadline';
import { errorMessage } from '../../data/rest';
import { Services } from '../../data/services';

/** What a page holding deadlines lets `DetailsEdits` do to its list. */
export interface DetailsPage {
  /** Puts this version of a deadline in place of the one with its id. */
  replace(deadline: Deadline): void;
  changed(): void;
}

/**
 * The shared Details box, for whichever page shows the deadline — the Deadlines tab or a
 * class's page. A save shows at once, since waiting on the network to see your own words is
 * what makes a box feel broken; if the server refuses it, the old text comes back with the
 * reason underneath.
 */
export class DetailsEdits {
  /** Why the last save of a deadline's details didn't stick, by deadline id. */
  readonly problems = new Map<string, string>();
  /** Details this student has reported this session, so the row can say it was sent. */
  readonly reported = new Set<string>();

  constructor(private readonly services: Services, private readonly page: DetailsPage) {}

  problem(deadline: Deadline): string | null {
    return this.problems.get(deadline.id) ?? null;
  }

  async save(deadline: Deadline, text: string): Promise<void> {
    const problem = DeadlineRules.detailsProblem(text);
    if (problem) {
      this.problems.set(deadline.id, problem);
      this.page.changed();
      return;
    }
    const details = text.trim();
    this.problems.delete(deadline.id);
    if (details === deadline.details) {
      this.page.changed();
      return;
    }
    this.page.replace({ ...deadline, details, detailsEditedAt: new Date() });
    this.page.changed();
    try {
      await this.services.deadlines.setDetails(deadline.id, details);
    } catch (error) {
      this.page.replace(deadline);
      this.problems.set(deadline.id, errorMessage(error, "Couldn't save the details."));
      this.page.changed();
    }
  }

  /** Flags the details for a moderator. The deadline stays up: its date is still right. */
  async report(deadline: Deadline): Promise<void> {
    try {
      await this.services.deadlines.report(deadline.id, 'details');
      this.reported.add(deadline.id);
      this.problems.delete(deadline.id);
    } catch (error) {
      this.problems.set(deadline.id, errorMessage(error, "Couldn't send that report."));
    }
    this.page.changed();
  }
}
