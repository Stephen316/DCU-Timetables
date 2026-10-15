import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { CalendarExport } from '../../core/calendarExport';
import { AlertSettings, ClassAlerts } from '../../core/classAlerts';
import { openCalendarFile } from '../../data/calendarFile';
import { errorMessage } from '../../data/rest';
import { PrefKey } from '../../data/storage';
import { usePrefJSON } from '../../state/hooks';
import { useWeekModel } from '../../state/root';
import { BottomCard, Icon, PrimaryButton, SecondaryButton, Txt } from '../../ui/components';
import { Space, useTheme } from '../../ui/theme';

type Export = { state: 'loading' } | { state: 'ready'; count: number; ics: string } | { state: 'failed'; message: string };

/**
 * Export to Calendar, from the ⋯ menu: the rest of the year as an .ics, each class with the
 * student's alert times. The file is made before the button is offered, so the tap that
 * hands it over is the tap a browser needs to allow the download.
 */
export function ExportCalendarCard({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  const week = useWeekModel();
  const [saved] = usePrefJSON<unknown>(PrefKey.classAlerts, null);
  const alerts = ClassAlerts.settings(saved);
  const [result, setResult] = useState<Export>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!visible) return;
    let current = true;
    week.remainingEvents()
      .then((events) => {
        if (current) setResult({ state: 'ready', count: events.length, ics: CalendarExport.ics(events, alerts, new Date()) });
      })
      .catch((error) => {
        if (current) setResult({ state: 'failed', message: errorMessage(error, "Couldn't load the rest of the year.") });
      });
    return () => {
      current = false;
    };
    // `alerts` is read fresh on each opening; a change while the card is up can wait.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, attempt, week]);

  // Starts again from loading, so the next opening never offers this one's file.
  const close = () => {
    onClose();
    setResult({ state: 'loading' });
  };
  const retry = () => {
    setResult({ state: 'loading' });
    setAttempt((n) => n + 1);
  };

  const add = (ics: string) => {
    openCalendarFile(ics, CalendarExport.fileName)
      .then(close)
      .catch((error) => setResult({ state: 'failed', message: errorMessage(error, "Couldn't hand the file to Calendar.") }));
  };

  const message =
    result.state === 'failed'
      ? result.message
      : `Adds your classes from today to the end of the year, ${alertPhrase(alerts)}. Your calendar won't follow later changes to the timetable — export again to pick them up.`;

  return (
    <BottomCard visible={visible} onClose={close}>
      <View style={styles.body}>
        <Icon name="calendar" size={30} color={theme.accent} />
        <Txt type="headline" style={styles.centred}>Export to Calendar</Txt>
        <Txt type="subheadline" color={result.state === 'failed' ? theme.destructive : theme.inkSecondary} style={styles.centred}>
          {message}
        </Txt>
      </View>
      <View style={styles.buttons}>
        {result.state === 'failed' ? (
          <PrimaryButton title="Try Again" onPress={retry} />
        ) : result.state === 'ready' ? (
          <PrimaryButton
            title={result.count === 1 ? 'Add 1 Class' : `Add ${result.count} Classes`}
            disabled={result.count === 0}
            onPress={() => add(result.ics)}
          />
        ) : (
          <PrimaryButton title="Getting the year…" busy onPress={() => undefined} />
        )}
        <SecondaryButton title="Not now" onPress={close} />
      </View>
    </BottomCard>
  );
}

/** "each with an alert 15 minutes before", as Notifications has it set. */
function alertPhrase(alerts: AlertSettings): string {
  const offsets = [...new Set([alerts.first, alerts.second].filter((o): o is number => o !== null))].sort((a, b) => a - b);
  const labels = offsets.map((o) => (o === 0 ? 'at the start' : ClassAlerts.label(o)));
  if (labels.length === 0) return 'without alerts';
  if (labels.length === 1) return `each with an alert ${labels[0]}`;
  return `each with alerts ${labels[1]} and ${labels[0]}`;
}

const styles = StyleSheet.create({
  body: { alignItems: 'center', gap: Space.m, paddingTop: Space.s },
  centred: { textAlign: 'center' },
  buttons: { gap: Space.s },
});
