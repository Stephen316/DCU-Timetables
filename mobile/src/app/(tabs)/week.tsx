import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { TimetableScreen } from '../../features/week/TimetableScreen';
import { useTutorial } from '../../features/tutorial/Tutorial';

/** The week as a grid: its own tab, drawn by the same screen as the day. */
export default function WeekRoute() {
  const tutorial = useTutorial();
  useFocusEffect(useCallback(() => tutorial?.signal('weekShown'), [tutorial]));
  return <TimetableScreen mode="week" />;
}
