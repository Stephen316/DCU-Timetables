import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';
import { TimetableScreen } from '../../features/week/TimetableScreen';
import { useWeekModel } from '../../state/root';
import { useWeekFirst } from '../../ui/floatingBar';

/** The front page: the day list on a phone, or on the Mac and a desktop-wide window the week. */
export default function TimetableRoute() {
  const model = useWeekModel();
  const weekFirst = useWeekFirst();
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
  return <TimetableScreen mode={weekFirst ? 'week' : 'day'} owner />;
}
