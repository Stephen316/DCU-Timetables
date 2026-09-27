import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import {
  ABUSE_REPORT_REASONS, Deadline, deadlineCountdown, DeadlineFields, DEADLINE_KINDS, DeadlineKind, deadlineKindLabel,
  DeadlineReportReason, DeadlineRules, DeadlineStanding, deadlineTrust, displayTitle, LABEL_LIMIT, reportReasonLabel,
  gradeWeightLabel, TITLE_LIMIT,
} from '../../core/deadline';
import {
  addDays, formatAbbreviated, formatTime, formatWeekdayDayMonth, formatWeekdayDayMonthTime, localDateString, startOfDay,
} from '../../core/time';
import {
  ActionRow, ActionSheet, AdaptiveStack, BarButton, Icon, InlineAction, Label, ListScroll, Row, Section, Sheet, Txt,
  useLargeText,
} from '../../ui/components';
import { deadlineKindIcon, deadlineTint } from '../../ui/meaning';
import { useNow } from '../../state/hooks';
import { Space, useTheme } from '../../ui/theme';

export interface DeadlineActions {
  onConfirm: () => void;
  /** "The details are wrong", or taking that back. */
  onDispute: () => void;
  /** The poster changing their own, for everyone. */
  onEdit: (fields: DeadlineFields) => void;
  /** This student's own name for it. Blank goes back to the shared title. */
  onRename: (label: string) => void;
  onDelete: () => void;
  onReport: (reason: DeadlineReportReason) => void;
  onHideAuthor: () => void;
}

/**
 * One shared date. `schedule` is the Deadlines tab's version, which names the module —
 * outside its own class page, that is the first thing you need to know.
 */
export function DeadlineRow({
  deadline, standing, isMine, variant, actions,
}: { deadline: Deadline; standing: DeadlineStanding; isMine: boolean; variant: 'module' | 'schedule'; actions: DeadlineActions }) {
  const theme = useTheme();
  const large = useLargeText();
  const [sheet, setSheet] = useState<'edit' | 'rename' | null>(null);
  const iconColor = variant === 'schedule' ? deadlineTint(deadline.kind, theme) : theme.inkSecondary;
  const trust = deadlineTrust(deadline, standing);
  const edited = deadline.editedAt ? ' · edited' : '';
  const dispute = standing.disputeSummary;
  const worth = gradeWeightLabel(deadline.gradeWeight);
  return (
    <Row>
      <View style={styles.rowBody}>
        <AdaptiveStack gap={Space.m}>
          <View style={styles.kindIcon} importantForAccessibility="no" accessibilityElementsHidden>
            <Icon name={deadlineKindIcon(deadline.kind)} color={iconColor} />
          </View>
          <View style={styles.text}>
            <Txt type={variant === 'schedule' ? 'headline' : 'body'}>{displayTitle(deadline)}</Txt>
            {/* Your own name for it would otherwise hide what classmates are talking about. */}
            {deadline.myLabel ? <Txt type="caption" color={theme.inkTertiary}>Shared as “{deadline.title}”</Txt> : null}
            {variant === 'schedule' ? (
              <>
                <Txt type="caption" color={theme.inkSecondary}>{deadline.moduleKey} {deadlineKindLabel(deadline.kind).toLowerCase()} · {worth}</Txt>
                <Txt type="caption" color={theme.inkSecondary}>{formatWeekdayDayMonthTime(deadline.due)}{edited}</Txt>
              </>
            ) : (
              <Txt type="caption" color={theme.inkSecondary}>{deadlineKindLabel(deadline.kind)}, due {formatAbbreviated(deadline.due)} · {worth}{edited}</Txt>
            )}
          </View>
          <Txt type="caption" color={theme.inkSecondary} style={styles.medium}>{deadlineCountdown(deadline.due)}</Txt>
        </AdaptiveStack>

        {/* One unverified person's date is worth less than three people's, and the row says which. */}
        <AdaptiveStack style={large ? undefined : styles.indent}>
          <View style={styles.text}>
            {trust === 'verified' ? (
              <Label icon="confirmed" text="Confirmed by a moderator" type="caption2" color={theme.tint.confirmed} />
            ) : (
              <Label
                icon={trust === 'confirmed' ? 'confirmed' : 'unconfirmed'}
                text={standing.summary}
                type="caption2"
                color={trust === 'confirmed' ? theme.tint.confirmed : theme.inkSecondary}
              />
            )}
            {dispute ? (
              <Label icon="warning" text={dispute} type="caption2" color={trust === 'disputed' ? theme.tint.off : theme.inkSecondary} />
            ) : null}
          </View>
          {isMine ? (
            // Swipe-to-delete on iOS; a visible button here, so it can be found without knowing to swipe.
            <View style={styles.actions}>
              <InlineAction title="Edit" onPress={() => setSheet('edit')} />
              <InlineAction title="Delete" tint={theme.destructive} onPress={actions.onDelete} />
            </View>
          ) : (
            <View style={styles.actions}>
              {standing.disputedByMe ? (
                // Tapping takes it back, the way "Confirmed" does.
                <InlineAction title="You said it's wrong" tint={theme.tint.off} onPress={actions.onDispute} />
              ) : (
                <InlineAction
                  title={standing.confirmedByMe ? 'Confirmed' : 'This is right'}
                  tint={standing.confirmedByMe ? theme.tint.confirmed : theme.accent}
                  onPress={actions.onConfirm}
                />
              )}
              <MoreMenu
                deadline={deadline}
                standing={standing}
                actions={actions}
                onRename={() => setSheet('rename')}
              />
            </View>
          )}
        </AdaptiveStack>
      </View>

      {isMine ? (
        <DeadlineForm
          visible={sheet === 'edit'}
          editing={{ deadline, standing }}
          onClose={() => setSheet(null)}
          onSubmit={actions.onEdit}
        />
      ) : (
        <RenameSheet
          visible={sheet === 'rename'}
          deadline={deadline}
          onClose={() => setSheet(null)}
          onSave={actions.onRename}
        />
      )}
    </Row>
  );
}

/**
 * "…" on someone else's deadline: say it's wrong (or right after all), give it your own
 * name, report it, or hide everything its author posts. None of it shows who posted it;
 * the server works that out.
 */
function MoreMenu({
  deadline, standing, actions, onRename,
}: { deadline: Deadline; standing: DeadlineStanding; actions: DeadlineActions; onRename: () => void }) {
  const theme = useTheme();
  const [mode, setMode] = useState<'menu' | 'reasons' | 'hide' | null>(null);
  return (
    <>
      <Pressable
        onPress={() => setMode('menu')}
        accessibilityRole="button"
        accessibilityLabel={`More for ${displayTitle(deadline)}`}
        style={styles.moreButton}
      >
        <Icon name="more" size={20} color={theme.inkSecondary} />
      </Pressable>
      <ActionSheet
        visible={mode === 'menu'}
        onClose={() => setMode(null)}
        actions={[
          standing.disputedByMe
            ? { label: "It's right after all", icon: 'confirmed', onPress: actions.onConfirm }
            : { label: 'The date or details are wrong', icon: 'warning', onPress: actions.onDispute },
          { label: deadline.myLabel ? 'Rename for me…' : 'Give it my own name…', icon: 'edit', onPress: onRename },
          { label: 'Report…', icon: 'flag', onPress: () => setMode('reasons') },
          { label: 'Hide posts from this person', icon: 'hide', destructive: true, onPress: () => setMode('hide') },
        ]}
      />
      <ActionSheet
        visible={mode === 'reasons'}
        onClose={() => setMode(null)}
        title="Why are you reporting this?"
        message="It's hidden from you straight away, and an administrator reviews it within a day. The person who posted it isn't told who reported it. If only the date is wrong, say so from the menu instead — it stays up with a warning for everyone."
        actions={ABUSE_REPORT_REASONS.map((reason) => ({ label: reportReasonLabel(reason), onPress: () => actions.onReport(reason) }))}
      />
      <ActionSheet
        visible={mode === 'hide'}
        onClose={() => setMode(null)}
        title="Hide posts from this person?"
        message="You won't see any deadline they share. You can show everyone again from Account."
        actions={[{ label: 'Hide their posts', destructive: true, onPress: actions.onHideAuthor }]}
      />
    </>
  );
}

/** A name only this student sees. The shared title stays underneath it on the row. */
function RenameSheet({
  visible, deadline, onClose, onSave,
}: { visible: boolean; deadline: Deadline; onClose: () => void; onSave: (label: string) => void }) {
  const theme = useTheme();
  const [label, setLabel] = useState(displayTitle(deadline));
  // Refilled each time it opens, so it starts from the name saved now.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setLabel(displayTitle(deadline));
  }

  const save = (value: string) => {
    onSave(value);
    onClose();
  };

  return (
    <Sheet
      visible={visible}
      title="Your name for it"
      onClose={onClose}
      left={<BarButton title="Cancel" onPress={onClose} />}
      right={<BarButton title="Save" bold onPress={() => save(label)} />}
    >
      <ListScroll>
        <Section footer={`Only you see this name, here and on your widgets. Everyone else still sees “${deadline.title}”.`}>
          <Row>
            <TextInput
              value={label}
              onChangeText={setLabel}
              maxLength={LABEL_LIMIT}
              placeholder={deadline.title}
              placeholderTextColor={theme.inkTertiary}
              style={[styles.input, { color: theme.ink }]}
              accessibilityLabel="Your name for this deadline"
              returnKeyType="done"
              autoFocus
              onSubmitEditing={() => save(label)}
            />
          </Row>
        </Section>
        {deadline.myLabel ? (
          <Section>
            <ActionRow title="Use the shared name" icon="undo" onPress={() => save('')} />
          </Section>
        ) : null}
      </ListScroll>
    </Sheet>
  );
}

/**
 * Adding a deadline, or the poster editing theirs. Kept to four fields — a title, what it
 * is, when it's due, and how much of the grade it's worth.
 */
export function DeadlineForm({
  visible, onClose, onSubmit, editing, defaultDue,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (fields: DeadlineFields) => void;
  editing?: { deadline: Deadline; standing: DeadlineStanding };
  /** Where a new one's date starts — the class it's added from. A week out when there's no class. */
  defaultDue?: Date;
}) {
  const theme = useTheme();
  const initial = editing?.deadline;
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<DeadlineKind>('assignment');
  const [due, setDue] = useState(() => addDays(new Date(), 7));
  // Kept as typed; blank is 0, which is not graded.
  const [weightText, setWeightText] = useState('');
  const weight = DeadlineRules.parseGradeWeight(weightText);
  const now = useNow();
  const valid = DeadlineRules.isValid(title, due, now) && weight !== null;

  // Filled in each time it opens, so an edit starts from what's saved now, not at first render.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setTitle(initial?.title ?? '');
      setKind(initial?.kind ?? 'assignment');
      setDue(initial?.due ?? defaultDue ?? addDays(new Date(), 7));
      setWeightText(initial && initial.gradeWeight > 0 ? String(initial.gradeWeight) : '');
    }
  }

  return (
    <Sheet
      visible={visible}
      title={editing ? 'Edit deadline' : 'Add a deadline'}
      onClose={onClose}
      left={<BarButton title="Cancel" onPress={onClose} />}
      right={
        <BarButton
          title={editing ? 'Save' : 'Add'}
          bold
          disabled={!valid}
          onPress={() => {
            if (weight === null) return;
            onSubmit({ title: title.trim(), kind, due, gradeWeight: weight });
            onClose();
          }}
        />
      }
    >
      <ListScroll>
        <Section footer={editing ? editFooter(editing, kind, due) : 'Everyone taking this module will see this.'}>
          <Row>
            <TextInput
              value={title}
              onChangeText={setTitle}
              maxLength={TITLE_LIMIT}
              placeholder="What's due?"
              placeholderTextColor={theme.inkTertiary}
              style={[styles.input, { color: theme.ink }]}
              accessibilityLabel="What's due?"
              returnKeyType="done"
            />
          </Row>
          <Row>
            <Txt type="footnote" color={theme.inkSecondary} style={styles.fieldLabel}>Type</Txt>
            <View style={styles.kinds}>
              {DEADLINE_KINDS.map((k) => (
                <Pressable
                  key={k}
                  onPress={() => setKind(k)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: k === kind }}
                  style={[styles.kind, { backgroundColor: k === kind ? theme.accent : theme.raised }]}
                >
                  <Label icon={deadlineKindIcon(k)} text={deadlineKindLabel(k)} type="footnote" color={k === kind ? theme.onAccent : theme.ink} />
                </Pressable>
              ))}
            </View>
          </Row>
          <Row>
            <View style={styles.dueRow}>
              <Txt type="footnote" color={theme.inkSecondary}>Due</Txt>
              <DuePicker value={due} onChange={setDue} />
            </View>
            {due.getTime() <= now.getTime() ? (
              <Txt type="caption" color={theme.tint.off}>That time has passed. Pick a later one.</Txt>
            ) : !editing && defaultDue && due.getTime() === defaultDue.getTime() ? (
              <Txt type="caption" color={theme.inkTertiary}>When this class starts</Txt>
            ) : null}
          </Row>
          <Row>
            <Txt type="footnote" color={theme.inkSecondary} style={styles.fieldLabel}>Worth</Txt>
            <View style={styles.weight}>
              <TextInput
                value={weightText}
                onChangeText={setWeightText}
                keyboardType="number-pad"
                maxLength={3}
                placeholder="0"
                placeholderTextColor={theme.inkTertiary}
                style={[styles.input, styles.weightInput, { color: theme.ink, backgroundColor: theme.raised }]}
                accessibilityLabel="Percent of the grade"
              />
              <Txt color={theme.inkSecondary}>%</Txt>
              {/* Read back in words, so 0 is seen to mean "not graded" rather than "nothing typed". */}
              <Txt type="footnote" color={weight === null ? theme.tint.off : theme.inkSecondary} style={styles.weightReadout}>
                {weight === null ? 'A whole number from 0 to 100' : gradeWeightLabel(weight)}
              </Txt>
            </View>
          </Row>
        </Section>
      </ListScroll>
    </Sheet>
  );
}

/** What saving will cost, said before it's spent: other people's vouches, or a verification. */
function editFooter({ deadline, standing }: { deadline: Deadline; standing: DeadlineStanding }, kind: DeadlineKind, due: Date): string {
  const parts = ['Everyone taking this module sees the change.'];
  // The poster's own vouch survives their edit, so it isn't counted as lost.
  const others = standing.confirmCount - (standing.confirmedByMe ? 1 : 0);
  if (others > 0 && DeadlineRules.editClearsConfirmations(deadline, kind, due)) {
    parts.push(others === 1
      ? "Changing the date or type clears the other person's confirmation — they vouched for the old one."
      : `Changing the date or type clears the ${others} other confirmations — they vouched for the old one.`);
  }
  if (deadline.status === 'verified') parts.push('It goes back to waiting on a moderator.');
  return parts.join(' ');
}

/**
 * The due date and the time as two small controls on one line. The form already opens on
 * the class's own time, so these are there to be changed, not filled in: iOS's compact
 * pickers (a pill that opens a calendar or a wheel), Android's dialogs behind two chips,
 * typed on the web. Changing one keeps the other.
 */
function DuePicker({ value, onChange }: { value: Date; onChange: (date: Date) => void }) {
  const theme = useTheme();
  const today = startOfDay(new Date());
  const setDay = (day: Date) =>
    onChange(new Date(day.getFullYear(), day.getMonth(), day.getDate(), value.getHours(), value.getMinutes()));
  const setTime = (time: Date) =>
    onChange(new Date(value.getFullYear(), value.getMonth(), value.getDate(), time.getHours(), time.getMinutes()));

  if (Platform.OS === 'ios') {
    return (
      <View style={styles.dueControls}>
        <DateTimePicker
          value={value}
          mode="date"
          display="compact"
          minimumDate={today}
          accentColor={theme.accent}
          themeVariant={theme.scheme}
          onValueChange={(_, date) => setDay(date)}
        />
        <DateTimePicker
          value={value}
          mode="time"
          display="compact"
          accentColor={theme.accent}
          themeVariant={theme.scheme}
          onValueChange={(_, date) => setTime(date)}
        />
      </View>
    );
  }
  if (Platform.OS === 'android') {
    return (
      <View style={styles.dueControls}>
        <InlineAction
          title={formatWeekdayDayMonth(value)}
          onPress={() => DateTimePickerAndroid.open({ value, mode: 'date', minimumDate: today, onValueChange: (_, date) => setDay(date) })}
        />
        <InlineAction
          title={formatTime(value)}
          onPress={() => DateTimePickerAndroid.open({ value, mode: 'time', is24Hour: true, onValueChange: (_, date) => setTime(date) })}
        />
      </View>
    );
  }
  return <TypedDate value={value} onChange={onChange} />;
}

function TypedDate({ value, onChange }: { value: Date; onChange: (date: Date) => void }) {
  const theme = useTheme();
  const [text, setText] = useState(`${localDateString(value)} ${formatTime(value)}`);
  const parsed = (() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(text.trim());
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
  })();
  return (
    <View>
      <TextInput
        value={text}
        onChangeText={(next) => {
          setText(next);
          const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(next.trim());
          if (m) onChange(new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
        }}
        placeholder="YYYY-MM-DD HH:MM"
        placeholderTextColor={theme.inkTertiary}
        style={[styles.input, { color: theme.ink }]}
        accessibilityLabel="Due date and time"
      />
      {parsed === null ? <Txt type="caption" color={theme.inkSecondary}>Write it as 2026-10-14 17:00.</Txt> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  rowBody: { gap: Space.xs },
  kindIcon: { width: 22, alignItems: 'center' },
  text: { flex: 1, gap: Space.xxs },
  medium: { fontWeight: '500' },
  indent: { marginLeft: 22 + Space.m },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  moreButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  input: { fontSize: 17, minHeight: 40 },
  fieldLabel: { marginBottom: Space.xs },
  dueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.m },
  dueControls: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s },
  kind: { borderRadius: 8, paddingHorizontal: Space.m, paddingVertical: Space.s },
  weight: { flexDirection: 'row', alignItems: 'center', gap: Space.s },
  weightInput: { width: 64, borderRadius: 8, paddingHorizontal: Space.m, textAlign: 'right' },
  weightReadout: { flex: 1, marginLeft: Space.s },
});
