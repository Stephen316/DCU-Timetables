import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import {
  Deadline, deadlineCountdown, DEADLINE_KINDS, DEADLINE_REPORT_REASONS, DeadlineKind, deadlineKindLabel,
  DeadlineReportReason, DeadlineRules, DeadlineStanding, reportReasonLabel,
} from '../../core/deadline';
import { addDays, formatAbbreviated, formatWeekdayDayMonthTime, localDateString, formatTime } from '../../core/time';
import {
  ActionSheet, AdaptiveStack, BarButton, Icon, InlineAction, Label, ListScroll, Row, Section, Sheet, Txt, useLargeText,
} from '../../ui/components';
import { deadlineKindIcon, deadlineTint } from '../../ui/meaning';
import { Space, useTheme } from '../../ui/theme';

export interface DeadlineActions {
  onConfirm: () => void;
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
  const iconColor = variant === 'schedule' ? deadlineTint(deadline.kind, theme) : theme.inkSecondary;
  return (
    <Row>
      <View style={styles.rowBody}>
        <AdaptiveStack gap={Space.m}>
          <View style={styles.kindIcon} importantForAccessibility="no" accessibilityElementsHidden>
            <Icon name={deadlineKindIcon(deadline.kind)} color={iconColor} />
          </View>
          <View style={styles.text}>
            <Txt type={variant === 'schedule' ? 'headline' : 'body'}>{deadline.title}</Txt>
            {variant === 'schedule' ? (
              <>
                <Txt type="caption" color={theme.inkSecondary}>{deadline.moduleKey} {deadlineKindLabel(deadline.kind).toLowerCase()}</Txt>
                <Txt type="caption" color={theme.inkSecondary}>{formatWeekdayDayMonthTime(deadline.due)}</Txt>
              </>
            ) : (
              <Txt type="caption" color={theme.inkSecondary}>{deadlineKindLabel(deadline.kind)}, due {formatAbbreviated(deadline.due)}</Txt>
            )}
          </View>
          <Txt type="caption" color={theme.inkSecondary} style={styles.medium}>{deadlineCountdown(deadline.due)}</Txt>
        </AdaptiveStack>

        {/* One unverified person's date is worth less than three people's, and the row says which. */}
        <AdaptiveStack style={large ? undefined : styles.indent}>
          <Label
            icon={standing.isConfirmed ? 'confirmed' : 'unconfirmed'}
            text={standing.summary}
            type="caption2"
            color={standing.isConfirmed ? theme.tint.confirmed : theme.inkSecondary}
            style={styles.text}
          />
          {isMine ? (
            // Swipe-to-delete on iOS; a visible button here, so it can be found without knowing to swipe.
            <InlineAction title="Delete" tint={theme.destructive} onPress={actions.onDelete} />
          ) : (
            <View style={styles.actions}>
              <InlineAction
                title={standing.confirmedByMe ? 'Confirmed' : 'This is right'}
                tint={standing.confirmedByMe ? theme.tint.confirmed : theme.accent}
                onPress={actions.onConfirm}
              />
              <ModerationMenu deadline={deadline} onReport={actions.onReport} onHideAuthor={actions.onHideAuthor} />
            </View>
          )}
        </AdaptiveStack>
      </View>
    </Row>
  );
}

/**
 * "…" on someone else's deadline: report it, or hide everything its author posts. Neither
 * shows who posted it; the server works that out.
 */
function ModerationMenu({
  deadline, onReport, onHideAuthor,
}: { deadline: Deadline; onReport: (reason: DeadlineReportReason) => void; onHideAuthor: () => void }) {
  const theme = useTheme();
  const [mode, setMode] = useState<'menu' | 'reasons' | 'hide' | null>(null);
  return (
    <>
      <Pressable
        onPress={() => setMode('menu')}
        accessibilityRole="button"
        accessibilityLabel={`More for ${deadline.title}`}
        style={styles.moreButton}
      >
        <Icon name="more" size={20} color={theme.inkSecondary} />
      </Pressable>
      <ActionSheet
        visible={mode === 'menu'}
        onClose={() => setMode(null)}
        actions={[
          { label: 'Report…', icon: 'flag', onPress: () => setMode('reasons') },
          { label: 'Hide posts from this person', icon: 'hide', destructive: true, onPress: () => setMode('hide') },
        ]}
      />
      <ActionSheet
        visible={mode === 'reasons'}
        onClose={() => setMode(null)}
        title="Why are you reporting this?"
        message="It's hidden from you straight away, and an administrator reviews it within a day. The person who posted it isn't told who reported it."
        actions={DEADLINE_REPORT_REASONS.map((reason) => ({ label: reportReasonLabel(reason), onPress: () => onReport(reason) }))}
      />
      <ActionSheet
        visible={mode === 'hide'}
        onClose={() => setMode(null)}
        title="Hide posts from this person?"
        message="You won't see any deadline they share. You can show everyone again from Account."
        actions={[{ label: 'Hide their posts', destructive: true, onPress: onHideAuthor }]}
      />
    </>
  );
}

/** Adding a deadline. Kept to three fields — a title, what it is, and when it's due. */
export function DeadlineForm({
  visible, onClose, onSubmit,
}: { visible: boolean; onClose: () => void; onSubmit: (title: string, kind: DeadlineKind, due: Date) => void }) {
  const theme = useTheme();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<DeadlineKind>('assignment');
  const [due, setDue] = useState(() => addDays(new Date(), 7));
  const valid = DeadlineRules.isValid(title, due);

  const reset = () => {
    setTitle('');
    setKind('assignment');
    setDue(addDays(new Date(), 7));
  };
  const close = () => {
    onClose();
    reset();
  };

  return (
    <Sheet
      visible={visible}
      title="Add a deadline"
      onClose={close}
      left={<BarButton title="Cancel" onPress={close} />}
      right={
        <BarButton
          title="Add"
          bold
          disabled={!valid}
          onPress={() => {
            onSubmit(title.trim(), kind, due);
            close();
          }}
        />
      }
    >
      <ListScroll>
        <Section footer="Everyone taking this module will see this.">
          <Row>
            <TextInput
              value={title}
              onChangeText={setTitle}
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
            <Txt type="footnote" color={theme.inkSecondary} style={styles.fieldLabel}>Due</Txt>
            <DuePicker value={due} onChange={setDue} />
          </Row>
        </Section>
      </ListScroll>
    </Sheet>
  );
}

/** A date and time in the future: the system picker where there is one, typed on the web. */
function DuePicker({ value, onChange }: { value: Date; onChange: (date: Date) => void }) {
  const theme = useTheme();
  const now = new Date();
  if (Platform.OS === 'ios') {
    return (
      <DateTimePicker
        value={value}
        mode="datetime"
        display="inline"
        minimumDate={now}
        accentColor={theme.accent}
        themeVariant={theme.scheme}
        onValueChange={(_, date) => onChange(date)}
      />
    );
  }
  if (Platform.OS === 'android') {
    // Android's pickers are dialogs, one for the date and one for the time.
    const pick = () =>
      DateTimePickerAndroid.open({
        value,
        mode: 'date',
        minimumDate: now,
        onValueChange: (_, date) =>
          DateTimePickerAndroid.open({ value: date, mode: 'time', is24Hour: true, onValueChange: (__, time) => onChange(time) }),
      });
    return <InlineAction title={formatAbbreviated(value)} onPress={pick} />;
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
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s },
  kind: { borderRadius: 8, paddingHorizontal: Space.m, paddingVertical: Space.s },
});
