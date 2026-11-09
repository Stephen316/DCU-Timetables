import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useRoot } from '../../state/root';
import { ActionRow, Section, Txt } from '../../ui/components';
import { Space, useTheme } from '../../ui/theme';
import { NotificationsSheet } from '../alerts/NotificationsSheet';
import { ExportCalendarCard } from '../week/ExportCalendarCard';
import { useTutorial } from '../tutorial/Tutorial';
import { AccountSheet } from './AccountSheet';

/**
 * The fourth tab: everything that isn't the timetable or the deadlines. Notifications and
 * calendar export open as sheets from the top of the page; below them is the account itself —
 * who you are, appearance, your ID, the tour, and the way out.
 */
export function AccountScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { signOut } = useRoot();
  const tutorial = useTutorial();
  const [sheet, setSheet] = useState<'alerts' | 'export' | null>(null);
  useFocusEffect(useCallback(() => tutorial?.signal('accountShown'), [tutorial]));

  return (
    <View style={[styles.fill, { backgroundColor: theme.canvas }]}>
      <View style={[styles.header, { paddingTop: insets.top + Space.s, borderBottomColor: theme.separator }]}>
        <Txt type="headline" accessibilityRole="header">Account</Txt>
      </View>
      <AccountSheet
        visible
        inline
        onClose={() => undefined}
        top={
          <Section header="Your timetable">
            <ActionRow title="Notifications" icon="bell" onPress={() => setSheet('alerts')} />
            <ActionRow title="Export to Calendar" icon="calendar" onPress={() => setSheet('export')} />
            <ActionRow title="Switch account" icon="swap" onPress={signOut} />
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
  header: { alignItems: 'center', justifyContent: 'center', minHeight: 44, paddingBottom: Space.xs, borderBottomWidth: StyleSheet.hairlineWidth },
});
