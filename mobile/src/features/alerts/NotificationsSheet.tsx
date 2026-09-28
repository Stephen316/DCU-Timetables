import { useEffect, useState } from 'react';
import { AppState, Linking, StyleSheet, View } from 'react-native';
import { AlertOffset, AlertSettings, ClassAlerts } from '../../core/classAlerts';
import { AlertPermission } from '../../data/alerts';
import { PrefKey } from '../../data/storage';
import { usePrefJSON, useServices } from '../../state/hooks';
import { useWeekModel } from '../../state/root';
import { ActionRow, BarButton, Icon, ListScroll, Row, Section, Sheet, Txt } from '../../ui/components';
import { useTheme } from '../../ui/theme';

/** Calendar's Default Alert Times, for classes: when each class alerts, and a second alert. */
export function NotificationsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { alerts } = useServices();
  const week = useWeekModel();
  const [saved, setSaved] = usePrefJSON<unknown>(PrefKey.classAlerts, null);
  const settings = ClassAlerts.settings(saved);
  const [permission, setPermission] = useState<AlertPermission | null>(null);

  // Read again on the way back from Settings, where the student may have just turned them on.
  useEffect(() => {
    if (!visible) return;
    const read = () => void alerts.permission().then(setPermission).catch(() => setPermission(null));
    read();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') read();
    });
    return () => sub.remove();
  }, [visible, alerts]);

  const choose = (which: keyof AlertSettings, offset: AlertOffset) => setSaved({ ...settings, [which]: offset });

  const allow = async () => {
    const answer = await alerts.requestPermission().catch(() => null);
    setPermission(answer);
    if (answer === 'granted') week.scheduleAlerts(true);
  };

  return (
    <Sheet visible={visible} title="Notifications" onClose={onClose} right={<BarButton title="Done" onPress={onClose} />}>
      <ListScroll>
        {permission === 'undetermined' ? (
          <Section footer="DCU Timetable needs your permission before it can alert you about classes.">
            <ActionRow title="Turn On Notifications" icon="bell" onPress={() => void allow()} />
          </Section>
        ) : permission === 'denied' ? (
          <Section footer="Notifications for DCU Timetable are turned off in Settings, so none of these alerts will appear.">
            <ActionRow title="Open Settings" icon="bell" onPress={() => void Linking.openSettings()} />
          </Section>
        ) : null}

        <OffsetList header="Class alert" selected={settings.first} onChoose={(o) => choose('first', o)} />
        <OffsetList
          header="Second alert"
          selected={settings.second}
          onChoose={(o) => choose('second', o)}
          footer="Alerts cover this week and next — the weeks the app has loaded — so open it at least once a week. Classes you've marked as not attending, and ones reported cancelled, don't alert you."
        />
      </ListScroll>
    </Sheet>
  );
}

/** Rows with a checkmark, as Appearance does: rows wrap at large text sizes, a picker doesn't. */
function OffsetList({ header, selected, onChoose, footer }: {
  header: string;
  selected: AlertOffset;
  onChoose: (offset: AlertOffset) => void;
  footer?: string;
}) {
  const theme = useTheme();
  return (
    <Section header={header} footer={footer}>
      {ClassAlerts.options.map((offset) => {
        const label = ClassAlerts.label(offset);
        const isSelected = offset === selected;
        return (
          <Row key={String(offset)} onPress={() => onChoose(offset)} accessibilityLabel={isSelected ? `${label}, selected` : label}>
            <View style={styles.line}>
              <Txt>{label}</Txt>
              {isSelected ? <Icon name="check" color={theme.accent} /> : null}
            </View>
          </Row>
        );
      })}
    </Section>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
