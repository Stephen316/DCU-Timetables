import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActionRow, ScreenHeader, Section } from '../../ui/components';
import { useTheme } from '../../ui/theme';
import { NotificationsSheet } from '../alerts/NotificationsSheet';
import { ExportCalendarCard } from '../week/ExportCalendarCard';
import { useTutorial } from '../tutorial/Tutorial';
import { AccountSheet } from './AccountSheet';

/**
 * The fourth tab: everything that isn't the timetable or the deadlines. Who's signed in first,
 * then the timetable's own settings — notifications and calendar export, each opening as a
 * sheet — then the account itself: appearance, your ID, the tour, and the way out.
 */
export function AccountScreen() {
  const theme = useTheme();
  const tutorial = useTutorial();
  const [sheet, setSheet] = useState<'alerts' | 'export' | null>(null);
  useFocusEffect(useCallback(() => tutorial?.signal('accountShown'), [tutorial]));

  return (
    <View style={[styles.fill, { backgroundColor: theme.canvas }]}>
      <ScreenHeader title="Account" />
      <AccountSheet
        visible
        inline
        onClose={() => undefined}
        top={
          <Section header="Your timetable">
            <ActionRow title="Notifications" icon="bell" tint={theme.modules[5]} chevron onPress={() => setSheet('alerts')} />
            <ActionRow title="Export to Calendar" icon="calendar" tint={theme.modules[0]} chevron onPress={() => setSheet('export')} />
          </Section>
        }
      />
      <NotificationsSheet visible={sheet === 'alerts'} onClose={() => setSheet(null)} />
      <ExportCalendarCard visible={sheet === 'export'} onClose={() => setSheet(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
