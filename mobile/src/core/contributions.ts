import { kindLabel, parseActivityCode } from './activityCode';
import { parseISO } from './time';

/**
 * What came of a student's own reports and deadlines (`my_recent_contributions`), told once
 * each: a report the crowd or an organiser agreed with, a deadline others confirmed.
 */
export interface Contribution {
  kind: 'report' | 'deadline';
  /** The class's event key, or the deadline's id. With `kind`, what's remembered as told. */
  ref: string;
  moduleKey: string | null;
  /** The deadline's own title. Null for a report. */
  title: string | null;
  /** Everyone who reported the class; the others who confirmed the deadline. */
  count: number;
  happenedAt: Date;
}

export const Contributions = {
  /** Rows from the RPC, skipping any that don't read as one. */
  decode(rows: Record<string, unknown>[]): Contribution[] {
    return rows.flatMap((r) => {
      const kind = r.kind === 'report' || r.kind === 'deadline' ? r.kind : null;
      const happenedAt = typeof r.happened_at === 'string' ? parseISO(r.happened_at) : null;
      const count = typeof r.count === 'number' ? r.count : Number(r.count);
      if (!kind || typeof r.ref !== 'string' || !happenedAt || !Number.isFinite(count)) return [];
      return [{
        kind,
        ref: r.ref,
        moduleKey: typeof r.module_key === 'string' ? r.module_key : null,
        title: typeof r.title === 'string' ? r.title : null,
        count,
        happenedAt,
      }];
    });
  },

  /** How one is remembered as told. */
  toldKey(c: Contribution): string {
    return `${c.kind}:${c.ref}`;
  },

  /**
   * What to tell now: the newest not told before. One card at a time, so opening the app is
   * never a stack of them; the rest wait for the next launch. Deadlines go together — three
   * confirmed is one piece of news, not three — so a deadline brings every untold deadline
   * with it, newest first. A report is told on its own.
   */
  next(all: Contribution[], told: string[]): Contribution[] | null {
    const seen = new Set(told);
    const untold = [...all].sort((a, b) => b.happenedAt.getTime() - a.happenedAt.getTime())
      .filter((c) => !seen.has(Contributions.toldKey(c)));
    const first = untold[0];
    if (!first) return null;
    return first.kind === 'deadline' ? untold.filter((c) => c.kind === 'deadline') : [first];
  },

  /**
   * The class a report was about, from its event key alone (`<activity>|<start>`), so a
   * class from a week the phone hasn't loaded still reads as one: "Digital Electronics lab".
   */
  className(eventKey: string, moduleName: (moduleKey: string) => string): string {
    const activity = parseActivityCode(eventKey.split('|')[0] ?? '');
    const kind = kindLabel(activity.kind).toLowerCase();
    if (!activity.moduleCode) return `your ${kind}`;
    return `${moduleName(activity.moduleCode)} ${kind}`;
  },

  /** The card's title and body, for what `next` gave. */
  message(shown: Contribution[], moduleName: (moduleKey: string) => string): { title: string; body: string } {
    const c = shown[0];
    if (shown.length > 1) {
      // Who confirmed them, as near as the counts say: classmates, a moderator, or both.
      const byClassmates = shown.some((d) => d.count > 0);
      const byModerator = shown.some((d) => d.count === 0);
      const who = byClassmates && byModerator ? 'Classmates and moderators' : byClassmates ? 'Your classmates' : 'A moderator';
      return { title: 'Your deadlines helped', body: `${who} confirmed ${shown.length} deadlines, which you added.` };
    }
    if (c.kind === 'report') {
      const others = c.count - 1;
      const what = Contributions.className(c.ref, moduleName);
      return {
        title: 'Your report helped',
        body: others > 0
          ? `You and ${others === 1 ? '1 other' : `${others} others`} reported ${what} cancelled, so your classmates knew not to go.`
          : `You reported ${what} cancelled, and an organiser confirmed it, so your classmates knew not to go.`,
      };
    }
    const where = c.moduleKey ? ` for ${moduleName(c.moduleKey)}` : '';
    const title = c.title ?? 'a deadline';
    return {
      title: 'Your deadline helped',
      body: c.count > 0
        ? `${c.count === 1 ? '1 classmate' : `${c.count} classmates`} confirmed “${title}”${where}, which you added.`
        : `A moderator confirmed “${title}”${where}, which you added.`,
    };
  },

  /** Told ones older than the RPC looks back are dropped, so the list stays small. */
  prune(told: string[], all: Contribution[]): string[] {
    const live = new Set(all.map(Contributions.toldKey));
    return told.filter((key) => live.has(key));
  },
};
