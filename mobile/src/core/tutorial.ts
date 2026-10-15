/**
 * The first-run tutorial's steps. The words are Stephen's, kept in docs/TUTORIAL_TEXT.txt —
 * change them there first and copy them here, so the two never drift.
 */

/** What a step's cut-out goes around. Each is registered by the control it names. */
export type TutorialTarget =
  | 'firstClass' // the first class on the day showing, or in the week grid on a Mac
  | 'dayHeading' // the day's name at the top of the day view
  | 'viewToggle' // the week / day button, top left
  | 'more' // ⋯, top right
  | 'deadlinesTab' // the Deadlines tab
  | 'weekGrid' // the whole week grid, on a Mac
  | 'reportSection'; // "Is it on?" on a class's page

/**
 * A movement the student makes to go on — shown as a moving hand, and passed through the
 * dimmed screen to the control underneath. Next still works, for anyone who can't make it.
 */
export type TutorialAction = 'swipeLeft' | 'tap' | 'scrollDown';

/** What the app tells the tutorial when the student does the step's action. */
export type TutorialSignal = 'daySwiped' | 'classOpened';

export interface TutorialStep {
  id: string;
  title: string;
  body: string | null;
  /** Null: a card in the middle of the screen, pointing at nothing. */
  target: TutorialTarget | null;
  action: TutorialAction | null;
  /** The signal that completes the action. */
  advancesOn: TutorialSignal | null;
  /** The screen it's shown on. A class step follows the student onto the class's page. */
  screen: 'timetable' | 'class';
  /**
   * While `scrollDown` hasn't yet brought the target into view, the title is the instruction;
   * once it has, this replaces it.
   */
  arrived: { title: string; body: string | null } | null;
  primary: string;
  /** The quieter way out on this card. Null on the last, where Done is the way out. */
  skip: string | null;
  /** Part of the step before it, so it doesn't count separately in "3 of 8". */
  continues: boolean;
}

function step(fields: Partial<TutorialStep> & Pick<TutorialStep, 'id' | 'title'>): TutorialStep {
  return {
    body: null, target: null, action: null, advancesOn: null, screen: 'timetable', arrived: null,
    primary: TutorialText.next, skip: TutorialText.skip, continues: false,
    ...fields,
  };
}

/** ON EVERY CARD and IN THE ACCOUNT SHEET. */
export const TutorialText = {
  count: (n: number, total: number) => `${n} of ${total}`,
  skip: 'Skip tutorial',
  next: 'Next',
  replay: 'Show the tutorial again',
};

const welcome = (body: string) =>
  step({ id: 'welcome', title: 'Welcome to DCU Timetable', body, primary: 'Start', skip: 'Skip' });

const PHONE: TutorialStep[] = [
  welcome("Here's a quick tour of the basics."),
  step({
    id: 'day', target: 'firstClass', title: 'Your day',
    body: "View each day's modules here. See locations, class type and lecturers.",
  }),
  step({
    id: 'swipe', target: 'dayHeading', title: 'Swipe left to see tomorrow',
    action: 'swipeLeft', advancesOn: 'daySwiped',
  }),
  step({ id: 'week', target: 'viewToggle', title: 'See the whole week', body: "Switch between today's list and the week grid." }),
  step({
    id: 'class', target: 'firstClass', title: 'Tap a class',
    body: "See its room, lecturer and what's due — and report it cancelled so your classmates know.",
    action: 'tap', advancesOn: 'classOpened',
  }),
  step({
    id: 'report', target: 'reportSection', screen: 'class', continues: true,
    title: 'Swipe down to see report cancelled', action: 'scrollDown',
    arrived: { title: 'Report it cancelled', body: "If a class isn't on, say so here and your classmates will see it." },
  }),
  step({ id: 'more', target: 'more', title: 'More', body: 'Edit your timetable, set class alerts, and manage your account.' }),
  step({
    id: 'deadlines', target: 'deadlinesTab', title: 'Deadlines',
    body: 'Assignments and tests shared by your classmates. Add one and everyone on the module sees it.',
  }),
  step({
    id: 'thanks', title: 'Thank you!', body: "You're all set. Replay this tour any time from Account.",
    primary: 'Done', skip: null,
  }),
];

const MAC: TutorialStep[] = [
  welcome("Here's a quick tour of the basics."),
  step({
    id: 'week', target: 'weekGrid', title: 'Your week',
    body: 'Every class this week, by day and time. Use the arrows or swipe on the trackpad for other weeks.',
  }),
  step({
    id: 'class', target: 'firstClass', title: 'Click a class',
    body: "See its room, lecturer and what's due — and report it cancelled so your classmates know.",
  }),
  step({ id: 'more', target: 'more', title: 'More', body: 'Edit your timetable, set class alerts, and manage your account.' }),
  step({
    id: 'deadlines', target: 'deadlinesTab', title: 'Deadlines',
    body: 'Assignments and tests shared by your classmates. Add one and everyone on the module sees it.',
    primary: 'Done', skip: null,
  }),
];

export const Tutorial = {
  /** The Mac app has no day view, so it has its own, shorter tour. */
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
   * The step after `index`. Skipping an action — Next instead of tapping the class — also
   * skips the steps that continue it, since the student never went where they happen.
   */
  next(steps: TutorialStep[], index: number, didAction: boolean): number {
    let next = index + 1;
    if (!didAction) while (steps[next]?.continues) next += 1;
    return next;
  },
};
