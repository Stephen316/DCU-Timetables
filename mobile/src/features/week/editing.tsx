import { useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { ActivityKind, activitySummary, kindLabel } from '../../core/activityCode';
import { CUSTOM_KINDS, CustomClass, CustomKind, timeAfter } from '../../core/customClasses';
import { EditRepeat, TimetableEdit } from '../../core/timetableEdits';
import { addDays, DublinTime, formatTime, formatWeekdayDayMonth, isSameDay, startOfDay, weekdayName } from '../../core/time';
import { shortTitleOf, TimetableEvent } from '../../core/timetableEvent';
import { errorMessage } from '../../data/rest';
import { ActionSheet, BottomCard, IconButton, InlineAction, PrimaryButton, SecondaryButton, Segmented, SheetAction, Spinner, Txt } from '../../ui/components';
import { TimeWheel } from '../../ui/TimeWheel';
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
  | { step: 'addRepeat'; session: TimetableEvent }
  | { step: 'ownRepeat'; draft: OwnClassDraft };

/** What the sheets hand back once the student has decided. */
export interface EditActions {
  edit: (edit: PendingEdit, repeat: EditRepeat) => void;
  replace: (cancelled: TimetableEvent, replacement: TimetableEvent, repeat: EditRepeat) => void;
  addClass: (session: TimetableEvent, repeat: EditRepeat) => void;
  addOwnClass: (draft: OwnClassDraft, repeat: EditRepeat) => void;
}

/** A class set at a time of the student's own, before they say how often. */
export type OwnClassDraft = Omit<CustomClass, 'id' | 'repeat'>;

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
  } else if (shown?.step === 'ownRepeat') {
    const { draft } = shown;
    const day = DublinTime.date(draft.date, draft.start);
    title = `Add ${draft.title ?? draft.code}?`;
    message = `${day ? weekdayName(day) : ''} ${draft.start}–${draft.end} · ${kindLabel(draft.kind)}`.trim();
    list = [
      { label: day ? `Add only on ${formatWeekdayDayMonth(day)}` : 'Add only this week', onPress: () => actions.addOwnClass(draft, 'once') },
      { label: 'Add every week', onPress: () => actions.addOwnClass(draft, 'weekly') },
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

/** One of the student's modules, as Add class offers it. */
export interface ModuleChoice {
  code: string;
  /** Its short name, or the code again when no class names it. */
  name: string;
}

/**
 * Add class: one of the student's modules picked, that module's classes this week out — its
 * lectures, labs and tutorials, one kind at a time — and a tap on one to take it on: another
 * group's lab, a lecture stream at a better time.
 */
export function AddClassCard({ visible, weekLabel, weekStart, modules, onFind, onPick, onSetOwn, onClose }: {
  visible: boolean;
  /** "week 6", for saying which week's classes these are. */
  weekLabel: string;
  /** The student's own modules: the only ones offered. */
  modules: ModuleChoice[];
  onFind: (code: string) => Promise<TimetableEvent[]>;
  onPick: (session: TimetableEvent) => void;
  /** Monday of the week on screen, for the days Set my own time offers. */
  weekStart: Date | null;
  onSetOwn: (draft: OwnClassDraft) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [mode, setMode] = useState<'find' | 'own'>('find');
  const [code, setCode] = useState<string | null>(null);
  const [own, setOwn] = useState<OwnForm>(() => blankOwnForm(weekStart));
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

  const week = weekLabel || 'this week';

  const find = (code: string) => {
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
    setCode(null);
    setMode('find');
    setOwn(blankOwnForm(weekStart));
    onClose();
  };

  /** Closes the card, then runs `next` once it has gone (on iOS, which needs it gone first). */
  const closeThen = (next: () => void) => {
    if (Platform.OS === 'ios') {
      pending.current = next;
      close();
      setTimeout(runPending, 700);
    } else {
      close();
      next();
    }
  };

  const pick = (session: TimetableEvent) => closeThen(() => onPick(session));

  const days = weekStart ? Array.from({ length: 5 }, (_, i) => addDays(startOfDay(weekStart), i)) : [];
  const start = `${String(own.hours).padStart(2, '0')}:${String(own.minutes).padStart(2, '0')}`;
  const end = timeAfter(start, own.length);
  const ownDay = days[own.day] ?? null;
  const ownReady = code !== null && end !== null && ownDay !== null;
  const setOwnTime = () => {
    if (!ownReady || !code || !ownDay || !end) return;
    const draft: OwnClassDraft = {
      code, title: own.title.trim() || null, kind: own.kind, date: DublinTime.dateString(ownDay), start, end,
      room: own.room.trim() || null,
    };
    closeThen(() => onSetOwn(draft));
  };

  /** In Find, a pick looks its classes up at once; in Set my own time, it only names the class. */
  const choose = (choice: string) => {
    setCode(choice);
    if (mode === 'find') find(choice);
  };

  const kinds = search.state === 'found' ? kindsIn(search.sessions) : [];
  const shown = search.state === 'found' ? search.sessions.filter((s) => s.activity.kind === kind) : [];

  return (
    <BottomCard visible={visible} onClose={close} onDismissed={runPending}>
      <View style={styles.header}>
        <View style={styles.close}>
          <IconButton icon="close" label="Close" color={theme.inkSecondary} onPress={close} />
        </View>
        <Txt type="headline" style={styles.centre}>Add a class</Txt>
        <Txt type="footnote" color={theme.inkSecondary} style={styles.centre}>
          {mode === 'find'
            ? `Pick one of your modules to see its lectures, labs and tutorials in ${week}.`
            : `A class at a time of your own, for one DCU's timetable doesn't show then. It's on ${week}.`}
        </Txt>
        <InlineAction
          title={mode === 'find' ? 'Set my own time instead' : "Find it in DCU's timetable instead"}
          onPress={() => {
            // Switching to Find with a module already picked shows its classes straight away.
            const next = mode === 'find' ? 'own' : 'find';
            setMode(next);
            if (next === 'find' && code && search.state !== 'found') find(code);
          }}
        />
      </View>
      {modules.length > 0 ? (
        <View style={styles.modules} accessibilityRole="radiogroup" accessibilityLabel="Module">
          {modules.map((m) => {
            const selected = m.code === code;
            return (
              <Pressable
                key={m.code}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={m.name === m.code ? m.code : `${m.name}, ${m.code}`}
                onPress={() => choose(m.code)}
                style={({ pressed }) => [
                  styles.module,
                  { backgroundColor: selected ? theme.accent : theme.raised },
                  pressed && { opacity: 0.6 },
                ]}
              >
                <Txt type="subheadline" numberOfLines={1} color={selected ? theme.onAccent : theme.ink} style={styles.moduleName}>
                  {m.name}
                </Txt>
                {m.name !== m.code ? (
                  <Txt type="footnote" numberOfLines={1} color={selected ? theme.onAccent : theme.inkSecondary}>{m.code}</Txt>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Txt type="footnote" color={theme.inkSecondary} style={styles.centre}>
          Your modules show here once your timetable has loaded.
        </Txt>
      )}
      {mode === 'own' ? (
        <>
          <TextInput
            value={own.title}
            onChangeText={(title) => setOwn({ ...own, title })}
            placeholder="Name (optional), e.g. Statistics"
            placeholderTextColor={theme.inkSecondary}
            accessibilityLabel="Name"
            style={[styles.input, { color: theme.ink, backgroundColor: theme.raised }]}
          />
          <Segmented
            label="Kind of class"
            options={CUSTOM_KINDS.map((k) => ({ value: k, label: kindLabel(k) }))}
            value={own.kind}
            onChange={(kind) => setOwn({ ...own, kind })}
          />
          {days.length > 0 ? (
            <Segmented
              label="Day"
              options={days.map((d, i) => ({ value: String(i), label: weekdayName(d).slice(0, 3) }))}
              value={String(own.day)}
              onChange={(i) => setOwn({ ...own, day: Number(i) })}
            />
          ) : null}
          <View style={styles.wheel}>
            <Txt type="footnote" color={theme.inkSecondary}>Starts at</Txt>
            <TimeWheel hours={own.hours} minutes={own.minutes} onChange={(hours, minutes) => setOwn({ ...own, hours, minutes })} />
          </View>
          <Segmented
            label="Length"
            options={LENGTHS.map((m) => ({ value: String(m), label: m === 60 ? '1 hour' : `${m / 60} hours` }))}
            value={String(own.length)}
            onChange={(m) => setOwn({ ...own, length: Number(m) })}
          />
          {end === null ? <Txt type="footnote" color={theme.destructive}>That runs past midnight: start it earlier or make it shorter.</Txt> : null}
          <TextInput
            value={own.room}
            onChangeText={(room) => setOwn({ ...own, room })}
            placeholder="Room (optional), e.g. GLA.QG15"
            placeholderTextColor={theme.inkSecondary}
            autoCapitalize="characters"
            autoCorrect={false}
            accessibilityLabel="Room"
            style={[styles.input, { color: theme.ink, backgroundColor: theme.raised }]}
          />
        </>
      ) : null}
      {mode === 'find' && search.state === 'searching' ? <Spinner label="Looking it up…" /> : null}
      {mode === 'find' && search.state === 'failed' ? <Txt type="footnote" color={theme.destructive}>{search.message}</Txt> : null}
      {mode === 'find' && search.state === 'found' && search.sessions.length === 0 ? (
        <Txt type="footnote" color={theme.inkSecondary} style={styles.centre}>
          Nothing on for {search.code} in {week}. Try another week.
        </Txt>
      ) : null}
      {mode === 'find' && kinds.length > 1 ? (
        <Segmented
          label="Kind of class"
          options={kinds.map((k) => ({ value: k, label: kindLabel(k) }))}
          value={kind}
          onChange={setKind}
        />
      ) : null}
      {mode === 'find' && shown.length > 0 ? (
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
        {mode === 'own' ? (
          <PrimaryButton title="Next" onPress={setOwnTime} disabled={!ownReady} />
        ) : search.state === 'failed' && code ? (
          <PrimaryButton title="Try again" onPress={() => find(code)} />
        ) : null}
        <SecondaryButton title="Cancel" onPress={close} />
      </View>
    </BottomCard>
  );
}

/** What Set my own time is holding while it's filled in. */
interface OwnForm {
  title: string;
  kind: CustomKind;
  /** Mon–Fri index into the week on screen. */
  day: number;
  hours: number;
  minutes: number;
  /** Minutes long. */
  length: number;
  room: string;
}

/** The lengths offered: most classes are one of these. */
const LENGTHS = [60, 120, 180];

/** A lecture at nine, on today if today is in the week on screen, else on its Monday. */
function blankOwnForm(weekStart: Date | null): OwnForm {
  const today = new Date();
  const index = weekStart ? Array.from({ length: 5 }, (_, i) => addDays(startOfDay(weekStart), i)).findIndex((d) => isSameDay(d, today)) : -1;
  return { title: '', kind: 'L', day: Math.max(index, 0), hours: 9, minutes: 0, length: 60, room: '' };
}

const styles = StyleSheet.create({
  header: { gap: Space.xs, alignItems: 'center' },
  // Over the card's top-left corner, clear of the centred title.
  close: { position: 'absolute', top: -Space.s, left: -Space.s, zIndex: 1 },
  centre: { textAlign: 'center' },
  input: { fontSize: 17, minHeight: 44, paddingHorizontal: Space.m, borderRadius: Radius.control },
  modules: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s },
  // Two to a row on a phone, more on a wider card.
  module: { flexGrow: 1, flexBasis: '45%', minHeight: 44, justifyContent: 'center', paddingHorizontal: Space.m, paddingVertical: Space.s, borderRadius: Radius.control },
  moduleName: { fontWeight: '600' },
  list: { borderRadius: Radius.control, overflow: 'hidden' },
  row: { paddingHorizontal: Space.m, paddingVertical: Space.s, gap: 2 },
  hairline: { height: StyleSheet.hairlineWidth, marginLeft: Space.m },
  buttons: { gap: Space.s },
  wheel: { alignItems: 'center', gap: Space.xs },
});
