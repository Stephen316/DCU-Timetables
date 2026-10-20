import { ClassHighlight, DeadlineKind, isSatInClass } from '../core/deadline';
import { IconName } from './components';
import { Palette } from './theme';

/**
 * The one place a highlight becomes a colour, so the day list and the calendar can never
 * disagree about what orange means.
 */
export function highlightTint(highlight: ClassHighlight, palette: Palette): string {
  switch (highlight.kind) {
    // A settled cancellation is grey, not orange: nothing to act on, the class just isn't on.
    case 'cancelled': return palette.inkTertiary;
    // Same orange for moved: turning up to the wrong room is as much "don't go where you
    // were going" as a possible cancellation, and a third colour would only add a thing to learn.
    case 'reported':
    case 'moved': return palette.tint.off;
    case 'test': return palette.tint.test;
    case 'assignment': return palette.tint.due;
  }
}

export function highlightIcon(highlight: ClassHighlight): IconName {
  switch (highlight.kind) {
    case 'cancelled': return 'cancelled';
    case 'reported': return 'alert';
    case 'moved': return 'moved';
    case 'test': return 'test';
    case 'assignment': return 'assignment';
  }
}

export function deadlineKindIcon(kind: DeadlineKind): IconName {
  return kind;
}

/** Same meaning, same colour as the outline in the timetable. */
export function deadlineTint(kind: DeadlineKind, palette: Palette): string {
  return isSatInClass(kind) ? palette.tint.test : palette.tint.due;
}
