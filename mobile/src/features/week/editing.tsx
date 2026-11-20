import { useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { ActivityKind, activitySummary, kindLabel } from '../../core/activityCode';
import { EditRepeat, ModuleCode, TimetableEdit } from '../../core/timetableEdits';
import { formatTime, formatWeekdayDayMonth, weekdayName } from '../../core/time';
import { shortTitleOf, TimetableEvent } from '../../core/timetableEvent';
import { errorMessage } from '../../data/rest';
import { ActionSheet, BottomCard, PrimaryButton, SecondaryButton, Segmented, SheetAction, Spinner, Txt } from '../../ui/components';
import { Radius, Space, useTheme } from '../../ui/theme';

/** What a tap does in Edit timetable: adds a ghost, or removes one of the student's classes. */
export type EditKind = TimetableEdit['kind'];

/** A class tapped in Edit timetable, waiting for "every week or just this once". */
export interface PendingEdit {
  event: TimetableEvent;
  kind: EditKind;
}

/**
 * Where a change in Edit timetable has got to. A tap on a class asks what to do with it; a
 * swap asks what to swap to and then for how long; a class found by Add class asks only for
 * how long.
 */
export type EditStep =
  | { step: 'choose'; edit: PendingEdit; cancelled: boolean; replacements: TimetableEvent[] }
  | { step: 'replaceWith'; event: TimetableEvent; replacements: TimetableEvent[] }
  | { step: 'replaceRepeat'; event: TimetableEvent; replacement: TimetableEvent }
  | { step: 'addRepeat'; session: TimetableEvent };

/** What the sheets hand back once the student has decided. */
export interface EditActions {
  edit: (edit: PendingEdit, repeat: EditRepeat) => void;
  replace: (cancelled: TimetableEvent, replacement: TimetableEvent, repeat: EditRepeat) => void;
  addClass: (session: TimetableEvent, repeat: EditRepeat) => void;
}

/** The longest list of swaps offered: past that, a week has more choice than a menu can show. */
const MAX_REPLACEMENTS = 8;

/** "Wednesday 13:00–14:00 · Lecture · Group 02", to tell one session of a module from another. */
function sessionLabel(event: TimetableEvent): string {
  return `${weekdayName(event.start)} ${formatTime(event.start)}–${formatTime(event.end)} · ${activitySummary(event.activity)}`;
}

const when = (event: TimetableEvent) => `${weekdayName(event.start)}, ${formatTime(event.start)}–${formatTime(event.end)}`;

/**
 * Every question Edit timetable asks, one card at a time: add or remove a class, swap one of
 * the student's (a cancelled one, most often) for another session of its module, or say how
 * long a found class is for. Each answer leads to the next card or to the change itself.
 */
export function EditSheets({ step, onStep, actions }: {
  step: EditStep | null;
  onStep: (step: EditStep | null) => void;
  actions: EditActions;
}) {
  // The card keeps its question while it slides away, rather than going blank.
  const [shown, setShown] = useState(step);
  if (step && step !== shown) setShown(step);

  let title: string | undefined;
  let message: string | undefined;
  let list: SheetAction[] = [];
  if (shown?.step === 'choose') {
    const { edit, cancelled, replacements } = shown;
    const verb = edit.kind === 'add' ? 'Add' : 'Remove';
    const remove = edit.kind === 'remove';
    // With a swap on offer it's no longer only a question of removing it.
    title = remove && replacements.length > 0 ? `Change ${shortTitleOf(edit.event)}?` : `${verb} ${shortTitleOf(edit.event)}?`;
    message = cancelled ? `${when(edit.event)} · reported cancelled` : when(edit.event);
    const replace: SheetAction[] = remove && replacements.length > 0
      ? [{ label: 'Replace with another session…', icon: 'swap', onPress: () => onStep({ step: 'replaceWith', event: edit.event, replacements }) }]
      : [];
    const choices: SheetAction[] = [
      { label: `${verb} every week`, destructive: remove, onPress: () => actions.edit(edit, 'weekly') },
      { label: `${verb} only on ${formatWeekdayDayMonth(edit.event.start)}`, destructive: remove, onPress: () => actions.edit(edit, 'once') },
    ];
    // A cancelled class is most likely being swapped; any other, dropped.
    list = cancelled ? [...replace, ...choices] : [...choices, ...replace];
  } else if (shown?.step === 'replaceWith') {
    const { event, replacements } = shown;
    title = `Replace ${shortTitleOf(event)} with…`;
    message = `Instead of ${when(event)}`;
    list = replacements.slice(0, MAX_REPLACEMENTS).map((replacement) => ({
      label: sessionLabel(replacement),
      onPress: () => onStep({ step: 'replaceRepeat', event, replacement }),
    }));
  } else if (shown?.step === 'replaceRepeat') {
    const { event, replacement } = shown;
    title = `Go to ${shortTitleOf(replacement)} instead?`;
    message = `${sessionLabel(replacement)}, in place of ${when(event)}`;
    // Just this once comes first: a cancellation is for a day, and the weeks after stay as they were.
    list = [
      { label: 'Only this week', onPress: () => actions.replace(event, replacement, 'once') },
      { label: 'Every week', onPress: () => actions.replace(event, replacement, 'weekly') },
    ];
  } else if (shown?.step === 'addRepeat') {
    const { session } = shown;
    title = `Add ${shortTitleOf(session)}?`;
    message = sessionLabel(session);
    list = [
      { label: `Add only on ${formatWeekdayDayMonth(session.start)}`, onPress: () => actions.addClass(session, 'once') },
      { label: 'Add every week', onPress: () => actions.addClass(session, 'weekly') },
    ];
  }

  return <ActionSheet visible={step !== null} title={title} message={message} actions={list} onClose={() => onStep(null)} />;
}

type Search =
  | { state: 'idle' }
  | { state: 'searching' }
  | { state: 'found'; code: string; sessions: TimetableEvent[] }
  | { state: 'failed'; message: string };

/** The order the kinds are offered in: lectures, then labs, then tutorials, then the rest. */
const KIND_ORDER: ActivityKind[] = ['L', 'P', 'T', 'S', 'W', '?'];

/** The kinds of class a module has, in `KIND_ORDER`. */
function kindsIn(sessions: TimetableEvent[]): ActivityKind[] {
  return KIND_ORDER.filter((kind) => sessions.some((s) => s.activity.kind === kind));
}

/**
 * Add class: a module code in, that module's classes this week out — its lectures, labs and
 * tutorials, one kind at a time — and a tap on one to take it on. Any module, the student's
 * own or not: a repeat, an elective, a friend's.
 */
export function AddClassCard({ visible, weekLabel, onFind, onPick, onClose }: {
  visible: boolean;
  /** "week 6", for saying which week's classes these are. */
  weekLabel: string;
  onFind: (code: string) => Promise<TimetableEvent[]>;
  onPick: (session: TimetableEvent) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [text, setText] = useState('');
  const [search, setSearch] = useState<Search>({ state: 'idle' });
  const [kind, setKind] = useState<ActivityKind>('L');
  const request = useRef(0);
  // iOS ignores a modal presented while another is still animating away, so the next card
  // waits for this one to finish going, with a fallback in case that never comes.
  const pending = useRef<(() => void) | null>(null);
  const runPending = () => {
    const next = pending.current;
    pending.current = null;
    next?.();
  };

  const code = ModuleCode.normalised(text);
  const valid = ModuleCode.isValid(code);
  const week = weekLabel || 'this week';

  const find = () => {
    if (!valid) return;
    const id = ++request.current;
    setSearch({ state: 'searching' });
    onFind(code)
      .then((sessions) => {
        if (id !== request.current) return;
        setSearch({ state: 'found', code, sessions });
        // Lectures if it has any, else whatever it does have.
        setKind(kindsIn(sessions)[0] ?? 'L');
      })
      .catch((error) => id === request.current && setSearch({ state: 'failed', message: errorMessage(error, "Couldn't look that module up.") }));
  };

  const close = () => {
    request.current++;
    setSearch({ state: 'idle' });
    setText('');
    onClose();
  };

  const pick = (session: TimetableEvent) => {
    if (Platform.OS === 'ios') {
      pending.current = () => onPick(session);
      close();
      setTimeout(runPending, 700);
    } else {
      close();
      onPick(session);
    }
  };

  const kinds = search.state === 'found' ? kindsIn(search.sessions) : [];
  const shown = search.state === 'found' ? search.sessions.filter((s) => s.activity.kind === kind) : [];

  return (
    <BottomCard visible={visible} onClose={close} onDismissed={runPending}>
      <View style={styles.header}>
        <Txt type="headline" style={styles.centre}>Add a class</Txt>
        <Txt type="footnote" color={theme.inkSecondary} style={styles.centre}>
          Any module&apos;s lectures, labs and tutorials, yours or not. Type its code to see them in {week}.
        </Txt>
      </View>
      <TextInput
        value={text}
        onChangeText={(value) => {
          setText(value);
          if (search.state !== 'searching') setSearch({ state: 'idle' });
        }}
        placeholder="Module code, e.g. MS121"
        placeholderTextColor={theme.inkSecondary}
        autoCapitalize="characters"
        autoCorrect={false}
        returnKeyType="search"
        onSubmitEditing={find}
        accessibilityLabel="Module code"
        style={[styles.input, { color: theme.ink, backgroundColor: theme.raised }]}
      />
      {search.state === 'searching' ? <Spinner label="Looking it up…" /> : null}
      {search.state === 'failed' ? <Txt type="footnote" color={theme.destructive}>{search.message}</Txt> : null}
      {search.state === 'found' && search.sessions.length === 0 ? (
        <Txt type="footnote" color={theme.inkSecondary} style={styles.centre}>
          Nothing on for {search.code} in {week}. Check the code, or try another week.
        </Txt>
      ) : null}
      {kinds.length > 1 ? (
        <Segmented
          label="Kind of class"
          options={kinds.map((k) => ({ value: k, label: kindLabel(k) }))}
          value={kind}
          onChange={setKind}
        />
      ) : null}
      {shown.length > 0 ? (
        <View style={[styles.list, { backgroundColor: theme.raised }]}>
          {shown.map((session, i) => (
            <View key={session.id}>
              {i > 0 ? <View style={[styles.hairline, { backgroundColor: theme.separator }]} /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Add ${shortTitleOf(session)}, ${sessionLabel(session)}`}
                onPress={() => pick(session)}
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
              >
                <Txt color={theme.accent}>{shortTitleOf(session)}</Txt>
                <Txt type="footnote" color={theme.inkSecondary}>
                  {[sessionLabel(session), session.locations.join(', ')].filter(Boolean).join(' · ')}
                </Txt>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.buttons}>
        {search.state !== 'found' || search.code !== code ? (
          <PrimaryButton title="Find classes" onPress={find} disabled={!valid} busy={search.state === 'searching'} />
        ) : null}
        <SecondaryButton title="Cancel" onPress={close} />
      </View>
    </BottomCard>
  );
}

const styles = StyleSheet.create({
  header: { gap: Space.xs, alignItems: 'center' },
  centre: { textAlign: 'center' },
  input: { fontSize: 17, minHeight: 44, paddingHorizontal: Space.m, borderRadius: Radius.control },
  list: { borderRadius: Radius.control, overflow: 'hidden' },
  row: { paddingHorizontal: Space.m, paddingVertical: Space.s, gap: 2 },
  hairline: { height: StyleSheet.hairlineWidth, marginLeft: Space.m },
  buttons: { gap: Space.s },
});
