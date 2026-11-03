import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Contribution, Contributions } from '../../core/contributions';
import { PrefKey } from '../../data/storage';
import { usePrefBool, usePrefJSON, useServices } from '../../state/hooks';
import { useWeekModel } from '../../state/root';
import { BottomCard, Icon, PrimaryButton, Txt } from '../../ui/components';
import { Space, useTheme } from '../../ui/theme';

/**
 * "Your report helped": once the timetable is up, what came of one of the student's own
 * reports or deadlines, told once. Never over the tutorial, which has the screen to itself.
 */
export function ContributionCard({ ready }: { ready: boolean }) {
  const theme = useTheme();
  const { profiles } = useServices();
  const week = useWeekModel();
  const [tutorialDue] = usePrefBool(PrefKey.tutorialDue);
  const [told, setTold] = usePrefJSON<string[]>(PrefKey.contributionsTold, []);
  const [shown, setShown] = useState<Contribution | null>(null);
  const asked = useRef(false);

  // Once per opening of the timetable; whatever else there is waits for the next launch.
  useEffect(() => {
    if (!ready || tutorialDue || asked.current) return;
    asked.current = true;
    profiles
      .myRecentContributions()
      .then((all) => {
        const kept = Contributions.prune(told, all);
        if (kept.length !== told.length) setTold(kept);
        setShown(Contributions.next(all, kept));
      })
      // Nothing to tell is the same as not being able to ask.
      .catch(() => undefined);
  }, [ready, tutorialDue, profiles, told, setTold]);

  const close = () => {
    if (shown) setTold([...told, Contributions.toldKey(shown)]);
    setShown(null);
  };

  const message = shown ? Contributions.message(shown, (key) => week.moduleName(key)) : null;
  return (
    <BottomCard visible={shown !== null && ready} onClose={close}>
      <View style={styles.body}>
        <Icon name={shown?.kind === 'deadline' ? 'confirmed' : 'report'} size={30} color={theme.accent} />
        <Txt type="headline" style={styles.centred}>{message?.title ?? ''}</Txt>
        <Txt type="subheadline" color={theme.inkSecondary} style={styles.centred}>{message?.body ?? ''}</Txt>
      </View>
      <View style={styles.buttons}>
        <PrimaryButton title="Done" onPress={close} />
      </View>
    </BottomCard>
  );
}

const styles = StyleSheet.create({
  body: { alignItems: 'center', gap: Space.m, paddingTop: Space.s },
  centred: { textAlign: 'center' },
  buttons: { gap: Space.s },
});
