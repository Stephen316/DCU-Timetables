import { useEffect, useReducer, useState } from 'react';
import { AppState, Linking, Pressable, StyleSheet, View } from 'react-native';
import { AlertOffset, AlertSettings, ClassAlerts } from '../../core/classAlerts';
import { PushKinds, PushKindsRules } from '../../core/webPush';
import { AlertPermission } from '../../data/alerts';
import { MacShell } from '../../data/macShell';
import { PrefKey } from '../../data/storage';
import { WebPush } from '../../data/webPush';
import { usePrefJSON, useServices } from '../../state/hooks';
import { useWeekModel } from '../../state/root';
import { ActionRow, BarButton, ListScroll, Row, Sheet, ToggleRow, Txt } from '../../ui/components';
import { light, MIN_TARGET, Radius, Space, useTheme } from '../../ui/theme';

import { SettingsIntro, SettingsSection as Section } from '../account/SettingsLayout';
import { useTabBarClearance } from '../../ui/floatingBar';

/**
 * Calendar's Default Alert Times, for classes: when each class alerts, and a second alert.
 * In a browser, which can't alert on its own, the notifications the server pushes instead.
 */
export function NotificationsSheet({ visible, onClose, inline = false }: { visible: boolean; onClose: () => void; inline?: boolean }) {
  const clearance = useTabBarClearance();
  const { alerts, webPush } = useServices();
  const week = useWeekModel();
  const [saved, setSaved] = usePrefJSON<unknown>(PrefKey.classAlerts, null);
  const settings = ClassAlerts.settings(saved);
  const [permission, setPermission] = useState<AlertPermission | null>(null);

  // Read again on the way back from Settings, where the student may have just turned them on.
  useEffect(() => {
    if (!visible || !alerts) return;
    const read = () => void alerts.permission().then(setPermission).catch(() => setPermission(null));
    read();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') read();
    });
    return () => sub.remove();
  }, [visible, alerts]);

  const choose = (which: keyof AlertSettings, offset: AlertOffset) => setSaved({ ...settings, [which]: offset });

  const allow = async () => {
    if (!alerts) return;
    const answer = await alerts.requestPermission().catch(() => null);
    setPermission(answer);
    if (answer === 'granted') week.scheduleAlerts(true);
  };

  const content = (
      <ListScroll contentStyle={inline ? { paddingBottom: clearance } : undefined}>
        <SettingsIntro title="Notifications" description="Choose how and when you hear about your timetable." />
        {!alerts && webPush ? (
          <WebPushSettings webPush={webPush} visible={visible} />
        ) : !alerts ? (
          <NotificationNotice title="Notifications unavailable" message="Notifications aren't available in this session. Open the installed app or a supported browser to set up alerts." />
        ) : permission === 'undetermined' ? (
          <Section footer="DCU Timetable needs your permission before it can alert you about classes.">
            <ActionRow title="Turn On Notifications" icon="bell" onPress={() => void allow()} />
          </Section>
        ) : permission === 'denied' ? (
          <Section footer={`Notifications for DCU Timetable are turned off in ${MacShell.isPresent() ? 'System Settings' : 'Settings'}, so none of these alerts will appear.`}>
            <ActionRow
              title={MacShell.isPresent() ? 'Open System Settings' : 'Open Settings'}
              icon="bell"
              onPress={() => (MacShell.isPresent() ? MacShell.openNotificationSettings() : void Linking.openSettings())}
            />
          </Section>
        ) : null}

        {/* Alerts before each class are the phone's own; pushes don't do them. */}
        {alerts ? (
          <>
            <OffsetList header="Class alert" selected={settings.first} onChoose={(o) => choose('first', o)} disabled={!alerts} />
            <OffsetList
              header="Second alert"
              selected={settings.second}
              onChoose={(o) => choose('second', o)}
              disabled={!alerts}
              footer="Alerts cover this week and next — the weeks the app has loaded — so open it at least once a week. Classes reported cancelled don't alert you."
            />
          </>
        ) : null}
      </ListScroll>
  );
  return inline ? content : <Sheet visible={visible} title="Notifications" onClose={onClose} right={<BarButton title="Done" onPress={onClose} />}>{content}</Sheet>;
}

/** The web build's notifications: asked for here, then a switch for each kind. */
function WebPushSettings({ webPush, visible }: { webPush: WebPush; visible: boolean }) {
  // Read on every render rather than kept: permission can change in Settings while the app
  // is away, and reading it costs nothing. `refresh` re-renders on the way back.
  const availability = webPush.availability();
  const [checked, refresh] = useReducer((n: number) => n + 1, 0);
  const [saved, setSaved] = usePrefJSON<unknown>(PrefKey.pushKinds, null);
  const kinds = PushKindsRules.read(saved);
  const [asking, setAsking] = useState(false);
  /** Allowed, but nothing to send to: never subscribed here, or subscribed with old keys. */
  const [subscribed, setSubscribed] = useState<boolean | null>(null);

  useEffect(() => {
    if (!visible) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') refresh();
    });
    return () => sub.remove();
  }, [visible]);

  useEffect(() => {
    if (!visible || availability !== 'granted') return;
    let current = true;
    void webPush.subscribed().then((yes) => current && setSubscribed(yes));
    return () => {
      current = false;
    };
  }, [visible, availability, checked, webPush]);

  const turnOn = () => {
    setAsking(true);
    // Called straight from the tap: Safari only asks for one.
    webPush
      .turnOn()
      .catch(() => undefined)
      .finally(() => {
        setAsking(false);
        refresh();
      });
  };
  const set = (which: keyof PushKinds, on: boolean) => setSaved({ ...kinds, [which]: on });

  const ask = (
    <Section footer="Get a notification before each of your classes, when one is cancelled or moved, when a classmate adds a deadline for one of your modules, and when a deadline is close.">
      <ActionRow title="Turn On Notifications" icon="bell" onPress={turnOn} busy={asking} />
    </Section>
  );
  switch (availability) {
    case 'addToHomeScreen':
      return <NotificationNotice title="Add to your Home Screen" message="On iPhone, add DCU Timetable to your Home Screen from the browser's Share menu, then open it from there to enable notifications." />;
    case 'unsupported':
      return <NotificationNotice title="Browser not supported" message="This browser can't show notifications from DCU Timetable. Use a supported browser or the installed app." />;
    case 'denied':
      return <NotificationNotice title="Notifications are blocked" message="Allow notifications for DCU Timetable in your browser or device settings, then return here." />;
    case 'ask':
      return ask;
    case 'granted':
      if (subscribed === false) return ask;
      return (
        <Section
          header="Notify me when"
          footer="Classes are covered for this week and next, the weeks the app has loaded, so open it at least once a week. Deadlines you've ticked off get no reminders."
        >
          <ToggleRow value={kinds.classAlerts} onChange={(on) => set('classAlerts', on)}><Txt>A class starts in 15 minutes</Txt></ToggleRow>
          <ToggleRow value={kinds.classStatus} onChange={(on) => set('classStatus', on)}><Txt>A class is cancelled or moved</Txt></ToggleRow>
          <ToggleRow value={kinds.newDeadlines} onChange={(on) => set('newDeadlines', on)}><Txt>A deadline is added</Txt></ToggleRow>
          <ToggleRow value={kinds.deadlineReminders} onChange={(on) => set('deadlineReminders', on)}><Txt>A deadline is due tomorrow, and 3 hours before</Txt></ToggleRow>
        </Section>
      );
  }
}

function NotificationNotice({ title, message }: { title: string; message: string }) {
  const theme = useTheme();
  return <Section header="Delivery">
    <Row><View style={{ gap: Space.s }}>
      <Txt type="headline">{title}</Txt>
      <Txt type="subheadline" color={theme.inkSecondary}>{message}</Txt>
    </View></Row>
  </Section>;
}

/**
 * The alert times as pills, as the Deadlines tab's Pending and Completed are: the chosen one
 * violet, the rest white. They wrap onto as many lines as the text size needs.
 */
function OffsetList({ header, selected, onChoose, disabled, footer }: {
  header: string;
  selected: AlertOffset;
  onChoose: (offset: AlertOffset) => void;
  disabled?: boolean;
  footer?: string;
}) {
  const theme = useTheme();
  return (
    <Section header={header} footer={footer}>
      <Row>
        <View style={styles.pills} accessibilityRole="radiogroup" accessibilityLabel={header}>
          {ClassAlerts.options.map((offset) => {
            const label = ClassAlerts.label(offset);
            const isSelected = offset === selected;
            return (
              <Pressable
                key={String(offset)}
                onPress={() => onChoose(offset)}
                disabled={disabled}
                accessibilityRole="radio"
                aria-checked={isSelected}
                accessibilityState={{ checked: isSelected, disabled: !!disabled }}
                accessibilityLabel={label}
                style={({ pressed }) => [
                  styles.pill,
                  { backgroundColor: isSelected ? light.accent : theme.raised, opacity: disabled ? 0.45 : pressed ? 0.7 : 1 },
                ]}
              >
                <Txt type="footnote" color={isSelected ? theme.onAccent : theme.ink} style={isSelected ? styles.semibold : undefined}>{label}</Txt>
              </Pressable>
            );
          })}
        </View>
      </Row>
    </Section>
  );
}

const styles = StyleSheet.create({
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s },
  pill: { minHeight: MIN_TARGET, justifyContent: 'center', borderRadius: Radius.control, paddingHorizontal: Space.m, paddingVertical: Space.s },
  semibold: { fontWeight: '600' },
});
