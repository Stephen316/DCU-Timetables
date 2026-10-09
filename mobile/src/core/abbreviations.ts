import { TimetableEvent } from './timetableEvent';

/**
 * What a module is called on the week grid, set in the console from any of its classes on the Timetable page
 * (`module_abbreviations`): "Eng. Maths I" for DCU's "EEG1007[1] Engineering Mathematics I".
 */
export interface ModuleAbbreviation {
  moduleKey: string;
  abbreviation: string;
}

export const ModuleAbbreviations = {
  /** Onto DCU's classes. Run before changes, so a class added by a change keeps its own name. */
  apply(events: TimetableEvent[], list: ModuleAbbreviation[]): TimetableEvent[] {
    if (list.length === 0) return events;
    const byModule = new Map(list.map((a) => [a.moduleKey, a.abbreviation]));
    return events.map((e) => {
      const abbreviation = e.activity.moduleCode ? byModule.get(e.activity.moduleCode) : undefined;
      return abbreviation ? { ...e, abbreviation } : e;
    });
  },

  /** A flagged module can have a row with no abbreviation yet; it has nothing to show. */
  fromRow(row: Record<string, unknown>): ModuleAbbreviation | null {
    const { module_key: moduleKey, abbreviation } = row;
    if (typeof moduleKey !== 'string' || typeof abbreviation !== 'string' || !abbreviation.trim()) return null;
    return { moduleKey, abbreviation: abbreviation.trim() };
  },
};
