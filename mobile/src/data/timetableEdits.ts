import { CustomClass, CustomClasses } from '../core/customClasses';
import { ModuleCode, TimetableEdit, TimetableEdits } from '../core/timetableEdits';
import { PrefKey, Prefs } from './storage';

/** The student's own timetable edits, kept on the phone alone. */
export const TimetableEditStore = {
  /**
   * The saved edits. The first read after the update also carries over the old "I won't
   * attend" list, so a class marked then stays off.
   */
  edits(prefs: Prefs): TimetableEdit[] {
    const saved = TimetableEdits.decode(prefs.getJSON<unknown>(PrefKey.timetableEdits, []));
    const skipped = prefs.getJSON<unknown>(PrefKey.skipped, null);
    if (!Array.isArray(skipped)) return saved;
    const carried = TimetableEdits.fromSkipped(skipped.filter((k): k is string => typeof k === 'string'))
      .reduce(TimetableEdits.adding, saved);
    prefs.setJSON(PrefKey.timetableEdits, carried);
    prefs.set(PrefKey.skipped, null);
    return carried;
  },

  add(prefs: Prefs, edit: TimetableEdit): void {
    prefs.setJSON(PrefKey.timetableEdits, TimetableEdits.adding(TimetableEditStore.edits(prefs), edit));
  },

  /** Saves a whole new list at once, so a swap is one change rather than two. */
  set(prefs: Prefs, edits: TimetableEdit[]): void {
    prefs.setJSON(PrefKey.timetableEdits, edits);
  },

  /** Module codes outside the course the student has taken a class of, "MS121". */
  extraModules(prefs: Prefs): string[] {
    const saved = prefs.getJSON<unknown>(PrefKey.extraModules, []);
    return Array.isArray(saved) ? saved.filter((c): c is string => typeof c === 'string' && ModuleCode.isValid(c)) : [];
  },

  /** Classes the student set at a time of their own. */
  customClasses(prefs: Prefs): CustomClass[] {
    return CustomClasses.decode(prefs.getJSON<unknown>(PrefKey.customClasses, []));
  },

  addCustomClass(prefs: Prefs, added: CustomClass): void {
    prefs.setJSON(PrefKey.customClasses, [...TimetableEditStore.customClasses(prefs), added]);
  },

  removeCustomClass(prefs: Prefs, id: string): void {
    prefs.setJSON(PrefKey.customClasses, TimetableEditStore.customClasses(prefs).filter((c) => c.id !== id));
  },

  addExtraModule(prefs: Prefs, code: string): void {
    const codes = TimetableEditStore.extraModules(prefs);
    if (!codes.includes(code)) prefs.setJSON(PrefKey.extraModules, [...codes, code]);
  },
};
