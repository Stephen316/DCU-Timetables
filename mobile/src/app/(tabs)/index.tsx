import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';
import { TimetableScreen } from '../../features/week/TimetableScreen';
import { useWeekModel } from '../../state/root';

export default function TimetableRoute() {
  const model = useWeekModel();
  const returning = useRef(false);
  // Back from a class's page: a report or a deadline may have been added there, and both
  // decide what the timetable outlines.
  useFocusEffect(
    useCallback(() => {
      if (returning.current) {
        void model.refreshCancellations().then(() => model.refreshDeadlines());
      }
      returning.current = true;
    }, [model]),
  );
  return <TimetableScreen />;
}
