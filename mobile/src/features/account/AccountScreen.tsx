import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ScreenHeader } from '../../ui/components';
import { useTheme } from '../../ui/theme';
import { NotificationsSheet } from '../alerts/NotificationsSheet';
import { ExportCalendarCard } from '../week/ExportCalendarCard';
import { useTutorial } from '../tutorial/Tutorial';
import { AccountSheet } from './AccountSheet';
import { SettingsLayout, SettingsTab } from './SettingsLayout';

/** Responsive settings workspace within the existing Account route. */
export function AccountScreen() {
  const theme = useTheme();
  const tutorial = useTutorial();
  const [tab, setTab] = useState<SettingsTab>('settings');
  useFocusEffect(useCallback(() => tutorial?.signal('accountShown'), [tutorial]));

  return (
    <View style={[styles.fill, { backgroundColor: theme.canvas }]}>
      <ScreenHeader title="Account" />
      <SettingsLayout selected={tab} onSelect={setTab}>
        {tab === 'settings' || tab === 'account' ? (
          <AccountSheet visible inline section={tab} onClose={() => undefined} />
        ) : tab === 'notifications' ? (
          <NotificationsSheet visible inline onClose={() => setTab('settings')} />
        ) : (
          <ExportCalendarCard visible inline onClose={() => setTab('settings')} />
        )}
      </SettingsLayout>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
