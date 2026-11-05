import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { errorMessage } from '../../data/rest';
import { PrefKey } from '../../data/storage';
import { usePrefBool, useServices } from '../../state/hooks';
import { useRoot } from '../../state/root';
import { BottomCard, Icon, PrimaryButton, SecondaryButton, Spinner, Txt } from '../../ui/components';
import { Radius, Space, useTheme } from '../../ui/theme';

type Subgroups = { state: 'loading' } | { state: 'ready'; labels: string[] } | { state: 'failed'; message: string };

/** "A.1"…"A.4" on one row, "B.1"… on the next: a row per lab group, as a lab timetable lists them. */
function byGroup(labels: string[]): string[][] {
  const rows = new Map<string, string[]>();
  for (const label of labels) {
    const group = label.includes('.') ? label.slice(0, label.indexOf('.')) : '';
    rows.set(group, [...(rows.get(group) ?? []), label]);
  }
  return [...rows.values()];
}

/**
 * "Which lab subgroup are you in?": the class list for the student's programme has more than
 * one student with their name, so the server can't tell which row is theirs. They pick a
 * subgroup, and the server uses it only to choose between the rows that share their name, so
 * it never shows them anyone else's name or labs.
 *
 * Until they answer they keep the programme's general timetable. Not now hides the card
 * until the next launch; the question stays until it's answered or the list changes.
 */
export function SubgroupCard({ ready }: { ready: boolean }) {
  const theme = useTheme();
  const { allocations } = useServices();
  const { subgroupQuestion: question, answerSubgroup } = useRoot();
  const [tutorialDue] = usePrefBool(PrefKey.tutorialDue);
  const [hidden, setHidden] = useState(false);
  const [subgroups, setSubgroups] = useState<Subgroups>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const visible = question !== null && ready && !tutorialDue && !hidden;
  const courseKey = question?.courseKey ?? null;

  useEffect(() => {
    if (!visible || !courseKey || !allocations) return;
    let current = true;
    allocations
      .subgroups(courseKey)
      .then((labels) => current && setSubgroups({ state: 'ready', labels }))
      .catch((error) => current && setSubgroups({ state: 'failed', message: errorMessage(error, "Couldn't load the subgroups.") }));
    return () => {
      current = false;
    };
  }, [visible, courseKey, allocations, attempt]);

  const send = () => {
    if (!picked) return;
    setSending(true);
    setMessage(null);
    answerSubgroup(picked)
      .then((outcome) => {
        // Matched: the question is gone and the card with it, onto the student's own labs.
        if (outcome === 'noMatch') {
          setMessage(`No one with your name is in ${picked}. Check the subgroup on your lab timetable and pick again.`);
        }
      })
      .catch((error) => setMessage(errorMessage(error, "Couldn't check that subgroup. Try again.")))
      .finally(() => setSending(false));
  };

  const failed = subgroups.state === 'failed';
  const note = message ?? (failed ? subgroups.message : null);
  return (
    <BottomCard visible={visible} onClose={() => setHidden(true)}>
      <View style={styles.body}>
        <Icon name="presentation" size={30} color={theme.accent} />
        <Txt type="headline" style={styles.centred}>Which lab subgroup are you in?</Txt>
        <Txt type="subheadline" color={theme.inkSecondary} style={styles.centred}>
          Someone else on your programme&apos;s class list has the same name as you. Pick your subgroup so the
          app shows your labs, not theirs. Until then you see the general timetable.
        </Txt>
      </View>

      {subgroups.state === 'loading' ? <Spinner /> : null}
      {subgroups.state === 'ready' ? (
        <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel="Lab subgroup">
          {byGroup(subgroups.labels).map((row) => (
            <View key={row[0]} style={styles.choiceRow}>
              {row.map((label) => {
                const selected = label === picked;
                return (
                  <Pressable
                    key={label}
                    onPress={() => {
                      setPicked(label);
                      setMessage(null);
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    style={({ pressed }) => [
                      styles.choice,
                      { borderColor: selected ? theme.accent : theme.separator, opacity: pressed ? 0.6 : 1 },
                    ]}
                  >
                    <Txt type="subheadline" color={selected ? theme.ink : theme.inkSecondary} style={selected ? styles.semibold : undefined}>
                      {label}
                    </Txt>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      ) : null}

      {note ? (
        <Txt type="footnote" color={theme.inkSecondary} style={styles.centred}>{note}</Txt>
      ) : null}

      <View style={styles.buttons}>
        {failed ? (
          <PrimaryButton
            title="Try again"
            onPress={() => {
              setSubgroups({ state: 'loading' });
              setAttempt((n) => n + 1);
            }}
          />
        ) : (
          <PrimaryButton title="Show my labs" onPress={send} disabled={!picked || sending} busy={sending} />
        )}
        <SecondaryButton title="Not now" onPress={() => setHidden(true)} />
      </View>
    </BottomCard>
  );
}

const styles = StyleSheet.create({
  body: { alignItems: 'center', gap: Space.m, paddingTop: Space.s },
  centred: { textAlign: 'center' },
  semibold: { fontWeight: '600' },
  choices: { gap: Space.s },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: Space.s },
  choice: {
    minWidth: 64, minHeight: 44, paddingHorizontal: Space.m, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderRadius: Radius.control,
  },
  buttons: { gap: Space.s },
});
