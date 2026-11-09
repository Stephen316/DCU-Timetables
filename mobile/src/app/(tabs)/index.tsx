import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { MacShell } from '../../data/macShell';
import { TimetableScreen } from '../../features/week/TimetableScreen';
import { useWeekModel } from '../../state/root';

/** The front page: the day list, or on the Mac (which has no day view) the week. */
export default function TimetableRoute() {
  const model = useWeekModel();
  const [onMac] = useState(() => MacShell.isPresent());
  const returning = useRef(false);
  // Back from a class's page: a report or a deadline may have been added there, and both
  // decide what the timetable outlines.
  useFocusEffect(
    useCallback(() => {
      if (returning.current) {
        void model.refreshOverlays();
      }
      returning.current = true;
    }, [model]),
  );
  return <TimetableScreen mode={onMac ? 'week' : 'day'} owner />;
}
