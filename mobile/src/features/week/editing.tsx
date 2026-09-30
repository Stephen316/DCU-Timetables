import { useState } from 'react';
import { EditRepeat, TimetableEdit } from '../../core/timetableEdits';
import { formatTime, formatWeekdayDayMonth, weekdayName } from '../../core/time';
import { shortTitleOf, TimetableEvent } from '../../core/timetableEvent';
import { ActionSheet } from '../../ui/components';

/** What a tap does in Edit timetable: adds a ghost, or removes one of the student's classes. */
export type EditKind = TimetableEdit['kind'];

/** A class tapped in Edit timetable, waiting for "every week or just this once". */
export interface PendingEdit {
  event: TimetableEvent;
  kind: EditKind;
}

/** Asks whether the change is for every week the class runs, or only this one. */
export function EditChoiceSheet({ pending, onChoose, onClose }: {
  pending: PendingEdit | null;
  onChoose: (edit: PendingEdit, repeat: EditRepeat) => void;
  onClose: () => void;
}) {
  // The card keeps its question while it slides away, rather than going blank.
  const [shown, setShown] = useState(pending);
  if (pending && pending !== shown) setShown(pending);
  const verb = shown?.kind === 'add' ? 'Add' : 'Remove';
  const remove = shown?.kind === 'remove';
  return (
    <ActionSheet
      visible={pending !== null}
      title={shown ? `${verb} ${shortTitleOf(shown.event)}?` : undefined}
      message={shown ? `${weekdayName(shown.event.start)}, ${formatTime(shown.event.start)}–${formatTime(shown.event.end)}` : undefined}
      actions={shown ? [
        { label: `${verb} every week`, destructive: remove, onPress: () => onChoose(shown, 'weekly') },
        { label: `${verb} only on ${formatWeekdayDayMonth(shown.event.start)}`, destructive: remove, onPress: () => onChoose(shown, 'once') },
      ] : []}
      onClose={onClose}
    />
  );
}
