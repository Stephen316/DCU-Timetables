/**
 * The first-run tutorial's steps. The words are Stephen's, kept in docs/TUTORIAL_TEXT.txt —
 * change them there first and copy them here, so the two never drift.
 *
 * The order goes forward through the app, so the student rarely has to come back the way they
 * came: the day, the week, a class (and back), Deadlines, then More, which ends the tour on
 * the week. Every control the tour points at, the student presses themselves.
 */

/** What a step's cut-out goes around. Each is registered by the control it names. */
export type TutorialTarget =
  | 'dayList' // the day's classes on the day view
  | 'dayHeading' // the day's name at the top of the day view
  | 'viewToggle' // the week / day button, top left
  | 'firstClass' // the week's first class in the week grid
  | 'weekGrid' // the whole week grid, on a Mac
  | 'reportButton' // "Report: lecture cancelled" on a class's page ("Mark as cancelled" for a moderator)
  | 'undoReport' // "Undo my report" on a class's page ("Mark as on" for a moderator)
  | 'backButton' // Back, in a class page's header
  | 'more' // ⋯, top right
  | 'deadlinesTab'; // the Deadlines tab

/**
 * A movement the student makes to go on — shown by a moving hand, and passed through the
 * dimmed screen to the control underneath.
 */
export type TutorialAction = 'swipeLeft' | 'tap' | 'scrollDown';

/** What the app tells the tutorial when the student does something a step waits for. */
export type TutorialSignal =
  | 'daySwiped'
  | 'weekShown'
  | 'classOpened'
  | 'reportMade'
  | 'reportUndone'
  | 'classClosed'
  | 'deadlinesShown'
  | 'menuOpened'
  | 'menuClosed';

export interface TutorialStep {
  id: string;
  title: string;
  body: string | null;
  /** Null: a card in the middle of the screen, pointing at nothing. */
  target: TutorialTarget | null;
  action: TutorialAction | null;
  /** The signal that completes the step. A step with one has no Next for a button: pressing it is how to go on. */
  advancesOn: TutorialSignal | null;
  /**
   * While `scrollDown` hasn't yet brought the target into view, the title is the instruction;
   * once it has, this replaces it.
   */
  arrived: { title: string; body: string | null } | null;
  /** Null on a step the student finishes by doing the thing. */
  primary: string | null;
  /** The quieter way out on this card. Null on the last, where Done is the way out. */
  skip: string | null;
  /** Part of the step before it, so it doesn't count separately in "3 of 8". */
  continues: boolean;
  /** Nothing drawn: a sheet the student opened is on top, and the tour waits for it to close. */
  hidden: boolean;
  /** The tour takes the student to the timetable itself, rather than asking them to go back. */
  toTimetable: boolean;
  /** Reports made on this step are a practice: shown on this phone, sent nowhere. */
  practice: boolean;
}

function step(fields: Partial<TutorialStep> & Pick<TutorialStep, 'id' | 'title'>): TutorialStep {
  return {
    body: null, target: null, action: null, advancesOn: null, arrived: null,
    primary: TutorialText.next, skip: TutorialText.skip, continues: false, hidden: false,
    toTimetable: false, practice: false,
    ...fields,
  };
}

/** A control the student presses to go on. */
function press(fields: Partial<TutorialStep> & Pick<TutorialStep, 'id' | 'title' | 'target' | 'advancesOn'>): TutorialStep {
  return step({ action: 'tap', primary: null, ...fields });
}

/** ON EVERY CARD and IN THE ACCOUNT SHEET. */
export const TutorialText = {
  count: (n: number, total: number) => `${n} of ${total}`,
  skip: 'Skip tutorial',
  next: 'Next',
  replay: 'Show the tutorial again',
};

const welcome = step({ id: 'welcome', title: 'Welcome to DCU Timetable', body: "Here's a quick tour of the basics.", primary: 'Start', skip: 'Skip' });

/** Tapping a class, reporting it cancelled, taking that back, and coming back out. */
function classSteps(tapTitle: string): TutorialStep[] {
  return [
    press({
      id: 'class', target: 'firstClass', advancesOn: 'classOpened', title: tapTitle,
      body: "See its room, lecturer and what's due — and report it cancelled so your classmates know.",
    }),
    press({
      id: 'report', target: 'reportButton', advancesOn: 'reportMade', continues: true, practice: true,
      title: 'Swipe down to see report cancelled', action: 'scrollDown',
      arrived: { title: 'Report it cancelled', body: "Tap here to report it. It's a practice run — nobody else sees it." },
    }),
    press({
      id: 'undo', target: 'undoReport', advancesOn: 'reportUndone', continues: true, practice: true,
      title: 'Now take it back', body: 'Tap here to undo it. A report can always be undone.',
    }),
    press({
      id: 'back', target: 'backButton', advancesOn: 'classClosed', continues: true,
      title: 'Go back', body: 'Tap Back, at the top left, to return to your week.',
    }),
  ];
}

const deadlines: TutorialStep[] = [
  press({ id: 'deadlines', target: 'deadlinesTab', advancesOn: 'deadlinesShown', title: 'Deadlines', body: 'Tap here to open them.' }),
  // On the page itself, so the student sees it before the tour moves on.
  step({
    id: 'deadlinesPage', continues: true, title: 'Deadlines',
    body: 'Assignments and tests shared by your classmates. Add one and everyone on the module sees it.',
  }),
];

const more: TutorialStep[] = [
  press({
    id: 'more', target: 'more', advancesOn: 'menuOpened', toTimetable: true, title: 'More',
    body: 'Edit your timetable, set class alerts, export it to your calendar, and manage your account.',
  }),
  step({ id: 'menu', advancesOn: 'menuClosed', continues: true, hidden: true, primary: null, title: 'More' }),
];

const thanks = step({
  id: 'thanks', toTimetable: true, title: 'Thank you!', body: "You're all set. Replay this tour any time from Account.",
  primary: 'Done', skip: null,
});

const PHONE: TutorialStep[] = [
  welcome,
  step({
    id: 'day', target: 'dayList', title: 'Your day',
    body: "View each day's modules here. See locations, class type and lecturers.",
  }),
  step({ id: 'swipe', target: 'dayHeading', title: 'Swipe left to see tomorrow', action: 'swipeLeft', advancesOn: 'daySwiped' }),
  press({ id: 'week', target: 'viewToggle', advancesOn: 'weekShown', title: 'See the whole week', body: 'Tap here to switch to the week grid.' }),
  ...classSteps('Tap a class'),
  ...deadlines,
  ...more,
  thanks,
];

const MAC: TutorialStep[] = [
  welcome,
  step({
    id: 'week', target: 'weekGrid', title: 'Your week',
    body: 'Every class this week, by day and time. Use the arrows or swipe on the trackpad for other weeks.',
  }),
  ...classSteps('Click a class'),
  ...deadlines,
  ...more,
  thanks,
];

export const Tutorial = {
  /** The Mac app has no day view, so its tour starts on the week. */
  steps(onMac: boolean): TutorialStep[] {
    return onMac ? MAC : PHONE;
  },

  /** "n of total" for a step, counting a continuing step as part of the one before it. */
  position(steps: TutorialStep[], index: number): { n: number; total: number } {
    const counted = steps.filter((s) => !s.continues).length;
    const n = steps.slice(0, index + 1).filter((s) => !s.continues).length;
    return { n: Math.max(n, 1), total: counted };
  },

  /**
   * The step after `index`. Skipping an action — Next on the swipe — or a step whose control
   * isn't there also skips the steps that continue it, since the student never got where
   * they happen.
   */
  next(steps: TutorialStep[], index: number, didAction: boolean): number {
    let next = index + 1;
    if (didAction) return next;
    // Already on a class's page (a report step with nothing to report): still go back out.
    const inside = steps[index]?.continues ?? false;
    while (steps[next]?.continues && !(inside && steps[next].advancesOn === 'classClosed')) next += 1;
    return next;
  },
};
