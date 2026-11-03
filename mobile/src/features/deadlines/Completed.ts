import { Prefs, PrefKey } from '../../data/storage';

/**
 * The deadlines this student has ticked off. Theirs alone and only a reminder to themselves,
 * so it stays on the device: nobody else's list changes when they finish.
 */
export class CompletedDeadlines {
  constructor(private readonly prefs: Prefs) {}

  has(id: string): boolean {
    return this.ids().has(id);
  }

  toggle(id: string): void {
    const ids = this.ids();
    if (!ids.delete(id)) ids.add(id);
    this.prefs.set(PrefKey.completedDeadlines, ids.size > 0 ? JSON.stringify([...ids]) : null);
  }

  private ids(): Set<string> {
    try {
      const parsed: unknown = JSON.parse(this.prefs.get(PrefKey.completedDeadlines) ?? '[]');
      return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
    } catch {
      return new Set();
    }
  }
}
