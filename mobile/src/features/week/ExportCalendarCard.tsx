import { useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { CalendarEntry, CalendarExport } from '../../core/calendarExport';
import { AlertSettings, ClassAlerts } from '../../core/classAlerts';
import { openCalendarFile } from '../../data/calendarFile';
import { GoogleCalendar, GoogleSignInCancelled } from '../../data/googleCalendar';
import { errorMessage } from '../../data/rest';
import { PrefKey } from '../../data/storage';
import { useServices, usePrefJSON } from '../../state/hooks';
import { useWeekModel } from '../../state/root';
import { BottomCard, Icon, PrimaryButton, SecondaryButton, Txt } from '../../ui/components';
import { Space, useTheme } from '../../ui/theme';

type Export =
  | { state: 'loading' }
  | { state: 'ready'; entries: CalendarEntry[]; ics: string }
  | { state: 'adding'; done: number; total: number }
  | { state: 'added'; count: number }
  | { state: 'failed'; message: string };

/** Google's sign-in library, loaded when the card opens so the tap can open Google's window. */
type GoogleLoad = 'loading' | 'ready' | 'failed';

/**
 * Export to Calendar, from the ⋯ menu: the rest of the year, each class with the student's
 * alert times, as an .ics file or — in a browser — straight into Google Calendar. The file is
 * made before the button is offered, so the tap that hands it over is the tap a browser needs
 * to allow the download; Google's sign-in is loaded ahead for the same reason. On Android,
 * where Google Calendar won't open an .ics, Google comes first.
 */
export function ExportCalendarCard({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  const week = useWeekModel();
  const { googleCalendar: google } = useServices();
  const [saved] = usePrefJSON<unknown>(PrefKey.classAlerts, null);
  const alerts = ClassAlerts.settings(saved);
  const [result, setResult] = useState<Export>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [googleLoad, setGoogleLoad] = useState<GoogleLoad>('loading');
  /** Bumped on closing, so a Google add still running then can't write into the next opening. */
  const opening = useRef(0);

  useEffect(() => {
    if (!visible) return;
    let current = true;
    week.remainingEvents()
      .then((events) => {
        if (current) setResult({ state: 'ready', entries: CalendarExport.entries(events, alerts), ics: CalendarExport.ics(events, alerts, new Date()) });
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

  const prepareGoogle = () => google?.prepare().then(() => setGoogleLoad('ready'), () => setGoogleLoad('failed'));
  useEffect(() => {
    if (visible) void prepareGoogle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, google]);
  /** After a failed load, the tap loads again; the next tap opens Google's window. */
  const loadGoogleAgain = () => {
    setGoogleLoad('loading');
    void prepareGoogle();
  };

  // Starts again from loading, so the next opening never offers this one's file.
  const close = () => {
    opening.current++;
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

  /** From the tap: Google's window opens before anything is awaited, or the browser blocks it. */
  const addToGoogle = (entries: CalendarEntry[]) => {
    if (!google) return;
    if (googleLoad === 'failed') return loadGoogleAgain();
    const signedIn = google.signIn();
    const mine = opening.current;
    const update = (next: Export) => {
      if (opening.current === mine) setResult(next);
    };
    signedIn
      .then((token) => {
        update({ state: 'adding', done: 0, total: entries.length });
        return google.add(token, entries, (done) => update({ state: 'adding', done, total: entries.length }));
      })
      .then(() => update({ state: 'added', count: entries.length }))
      .catch((error) => {
        // Closing Google's window leaves the choice as it was.
        if (error instanceof GoogleSignInCancelled) return;
        update({ state: 'failed', message: errorMessage(error, "Couldn't add the classes to Google Calendar.") });
      });
  };

  const classes = (n: number) => (n === 1 ? '1 class' : `${n} classes`);
  const message =
    result.state === 'failed' ? result.message
      : result.state === 'adding' ? `Adding ${result.done} of ${classes(result.total)} to Google Calendar…`
        : result.state === 'added'
          ? `Added ${classes(result.count)} to the "${CalendarExport.calendarName}" calendar in Google Calendar, ${alertPhrase(alerts)}. It won't follow later changes to the timetable — add them again to pick them up.`
          // With Google beside the file, neither button has room for the count, so it's said here.
          : `Adds your ${google && result.state === 'ready' ? classes(result.entries.length) : 'classes'} from today to the end of the year, ${alertPhrase(alerts)}. Your calendar won't follow later changes to the timetable — export again to pick them up.`;

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
          google ? (
            <ExportChoices
              count={result.entries.length}
              googleLoad={googleLoad}
              onFile={() => add(result.ics)}
              onGoogle={() => addToGoogle(result.entries)}
            />
          ) : (
            <PrimaryButton
              title={result.entries.length === 1 ? 'Add 1 Class' : `Add ${result.entries.length} Classes`}
              disabled={result.entries.length === 0}
              onPress={() => add(result.ics)}
            />
          )
        ) : result.state === 'adding' ? (
          <PrimaryButton title="Adding to Google Calendar…" busy onPress={() => undefined} />
        ) : result.state === 'added' ? (
          <PrimaryButton title="Open Google Calendar" onPress={() => void Linking.openURL('https://calendar.google.com/')} />
        ) : (
          <PrimaryButton title="Getting the year…" busy onPress={() => undefined} />
        )}
        <SecondaryButton title={result.state === 'added' ? 'Done' : result.state === 'adding' ? 'Close' : 'Not now'} onPress={close} />
      </View>
    </BottomCard>
  );
}

/**
 * The file and Google, side by side. Google leads on Android, where the file opens nowhere
 * useful for most; the file leads elsewhere, opening straight into Calendar or Outlook.
 */
function ExportChoices({ count, googleLoad, onFile, onGoogle }: {
  count: number; googleLoad: GoogleLoad; onFile: () => void; onGoogle: () => void;
}) {
  const googleFirst = GoogleCalendar.preferred();
  const googleTitle = googleLoad === 'failed' ? 'Try Google Calendar Again' : 'Add to Google Calendar';
  const googleBusy = googleLoad === 'loading';
  const fileTitle = googleFirst ? 'Download Calendar File' : 'Add to Calendar';
  if (googleFirst) {
    return (
      <>
        <PrimaryButton title={googleTitle} busy={googleBusy} disabled={count === 0} onPress={onGoogle} />
        <SecondaryButton title={fileTitle} disabled={count === 0} onPress={onFile} />
      </>
    );
  }
  return (
    <>
      <PrimaryButton title={fileTitle} disabled={count === 0} onPress={onFile} />
      <SecondaryButton title={googleTitle} disabled={count === 0 || googleBusy} onPress={onGoogle} />
    </>
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
