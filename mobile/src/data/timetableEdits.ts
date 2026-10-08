import { TimetableEdit, TimetableEdits } from '../core/timetableEdits';
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
};
