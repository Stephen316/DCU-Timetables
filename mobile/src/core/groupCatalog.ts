import { ActivityKind } from './activityCode';
import { groupKeyOf, groupLabelOf, TimetableEvent } from './timetableEvent';

/** One selectable attendance group within a module (e.g. "Lab P1"). */
export interface GroupOption {
  key: string;
  moduleCode: string;
  moduleName: string;
  kind: ActivityKind;
  label: string;
}

/** A module and its distinct groups, for the group-selection sheet. */
export interface ModuleGroups {
  moduleCode: string;
  moduleName: string;
  groups: GroupOption[];
}

/** Derives the selectable group structure from a set of timetable events. */
export const GroupCatalog = {
  /**
   * Modules and their *selectable* streams. Lectures are excluded — everyone attends all
   * lecture slots, so they aren't a choice. Modules with no other group are omitted.
   */
  modules(events: TimetableEvent[]): ModuleGroups[] {
    const order: string[] = [];
    const names = new Map<string, string>();
    const groups = new Map<string, Map<string, GroupOption>>();

    for (const event of events) {
      if (event.activity.kind === 'L') continue;
      const code = event.activity.moduleCode ?? event.activity.raw;
      if (!groups.has(code)) {
        groups.set(code, new Map());
        order.push(code);
      }
      if (event.moduleName !== null && !names.has(code)) names.set(code, event.moduleName);
      const key = groupKeyOf(event);
      groups.get(code)!.set(key, {
        key,
        moduleCode: code,
        moduleName: event.moduleName ?? code,
        kind: event.activity.kind,
        label: groupLabelOf(event),
      });
    }

    return order
      .flatMap((code) => {
        const options = [...(groups.get(code)?.values() ?? [])].sort((a, b) => compare(a.label, b.label));
        return options.length === 0 ? [] : [{ moduleCode: code, moduleName: names.get(code) ?? code, groups: options }];
      })
      .sort((a, b) => compare(a.moduleCode, b.moduleCode));
  },

  /** Events a student attends, given the group keys they've hidden. */
  filter(events: TimetableEvent[], hidden: Set<string>): TimetableEvent[] {
    if (hidden.size === 0) return events;
    return events.filter((e) => !hidden.has(groupKeyOf(e)));
  },
};

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
