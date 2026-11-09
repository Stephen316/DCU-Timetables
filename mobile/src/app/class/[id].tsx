import { Stack, useLocalSearchParams } from 'expo-router';
import { LectureScreen } from '../../features/lecture/LectureScreen';
import { useModel } from '../../state/hooks';
import { useWeekModel } from '../../state/root';
import { EmptyState } from '../../ui/components';
import { useTheme } from '../../ui/theme';

/** One class's page, opened from a row on the day or a block on the grid. */
export default function ClassRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const model = useModel(useWeekModel());
  const event = id ? model.eventWithID(id) : null;
  const theme = useTheme();
  // Drawn as the tabs' own headers are: the title centred and bold on the canvas, no rule
  // beneath, and the back arrow in violet.
  const header = {
    headerTitleAlign: 'center' as const,
    headerShadowVisible: false,
    headerStyle: { backgroundColor: theme.canvas },
    headerTintColor: theme.accent,
    headerTitleStyle: { color: theme.ink, fontWeight: '700' as const },
  };
  if (!event) {
    return (
      <>
        <Stack.Screen options={{ ...header, title: 'Class' }} />
        <EmptyState icon="calendar" title="Class not found" message="It may have moved to another week. Go back and open it again." />
      </>
    );
  }
  return (
    <>
      <Stack.Screen options={{ ...header, title: event.activity.moduleCode ?? 'Class' }} />
      {/* The same stores and the deadlines already in hand, so the page opens with content. */}
      <LectureScreen event={event} isClashing={model.clashingIDs.has(event.id)} known={model.deadlines} />
    </>
  );
}
