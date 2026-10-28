import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { MacShell } from '../../data/macShell';
import { LectureScreen } from '../../features/lecture/LectureScreen';
import { useModel } from '../../state/hooks';
import { useWeekModel } from '../../state/root';
import { EmptyState, IconButton, useWide } from '../../ui/components';

/** One class's page, opened from a row on the day or a block on the grid. */
export default function ClassRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const model = useModel(useWeekModel());
  const [inMacApp] = useState(() => MacShell.isPresent());
  const wide = useWide();
  const onDesktop = inMacApp || wide;
  const event = id ? model.eventWithID(id) : null;
  const backButton = onDesktop
    ? () => (
        <IconButton
          icon="arrowLeft"
          label="Back"
          onPress={() => (router.canGoBack() ? router.back() : router.push('/'))}
        />
      )
    : undefined;

  if (!event) {
    return (
      <>
        <Stack.Screen options={{ title: 'Class', headerLeft: backButton }} />
        <EmptyState icon="calendar" title="Class not found" message="It may have moved to another week. Go back and open it again." />
      </>
    );
  }
  return (
    <>
      <Stack.Screen options={{ title: event.activity.moduleCode ?? 'Class', headerLeft: backButton }} />
      {/* The same stores and the deadlines already in hand, so the page opens with content. */}
      <LectureScreen event={event} isClashing={model.clashingIDs.has(event.id)} known={model.deadlines} />
    </>
  );
}
