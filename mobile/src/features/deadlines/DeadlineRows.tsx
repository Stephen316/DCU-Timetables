import { ReactNode, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, TextInput, View } from 'react-native';
import {
  ABUSE_REPORT_REASONS, Deadline, deadlineCountdown, DeadlineFields, DEADLINE_KINDS, DeadlineKind, deadlineKindLabel,
  DeadlinePlacement, DeadlineReportReason, DeadlineRules, DeadlineStanding, deadlineTrust, DETAILS_LIMIT, detailsEditedLabel,
  displayTitle, LABEL_LIMIT, ModuleChoice, reportReasonLabel, gradeWeightLabel, TITLE_LIMIT,
} from '../../core/deadline';
import { addDays, formatAbbreviated, formatTime, formatWeekdayDayMonthTime } from '../../core/time';
import {
  ActionRow, ActionSheet, AdaptiveStack, BarButton, Icon, InlineAction, Label, ListScroll, Row, Section, Sheet, Txt,
  useLargeText, useReduceMotion,
} from '../../ui/components';
import { DropdownMenu } from '../../ui/DropdownMenu';
import { deadlineKindIcon, deadlineTint } from '../../ui/meaning';
import { useNow } from '../../state/hooks';
import { Radius, Space, useTheme, withAlpha } from '../../ui/theme';
import { DuePicker } from './DuePicker';
import { canEdit, Moderation } from './Moderation';

export interface DeadlineActions {
  onConfirm: () => void;
  /** "The details are wrong", or taking that back. */
  onDispute: () => void;
  /** The poster (or an admin) changing it for everyone: their fields, and the shared details alongside. */
  onEdit: (fields: DeadlineFields, details: string) => void;
  /** This student's own name for it. Blank goes back to the shared title. */
  onRename: (label: string) => void;
  onDelete: () => void;
  onReport: (reason: DeadlineReportReason) => void;
  onHideAuthor: () => void;
  /** The shared Details box: anyone's to change, on anyone's deadline. */
  onSaveDetails: (text: string) => void;
  onReportDetails: () => void;
  /** A moderator's Confirm, or taking it back. */
  onVerify: () => void;
  /** Ticking it off for this student alone, or unticking it. */
  onToggleCompleted: () => void;
}

const STUDENT: Moderation = { canVerify: false, canEditAny: false };

/**
 * One shared date. `schedule` is the Deadlines tab's version: a compact card with its kind's
 * colour down the edge, naming the module — outside its own class page, that is the first
 * thing you need to know.
 */
export function DeadlineRow({
  deadline, moduleName, standing, isMine, variant, showDate = true, actions, detailsProblem = null, detailsReported = false,
  moderation = STUDENT, completed = false,
}: {
  deadline: Deadline;
  /** What to call its module on the `schedule` row: the name, or the code when there isn't one. */
  moduleName?: string;
  standing: DeadlineStanding;
  isMine: boolean;
  variant: 'module' | 'schedule';
  /** On the `schedule` row, the weekday and date under the module. Today and Tomorrow need only the time. */
  showDate?: boolean;
  actions: DeadlineActions;
  /** Why the last save of the details didn't stick, said under them. */
  detailsProblem?: string | null;
  detailsReported?: boolean;
  moderation?: Moderation;
  /** Ticked off by this student: the row turns green. */
  completed?: boolean;
}) {
  const theme = useTheme();
  const large = useLargeText();
  // Whoever may edit the whole deadline does it in one form, details and all.
  const editsAll = canEdit(moderation, isMine);

  // Mark done sweeps a tick across the row before it settles green; unticking is instant.
  const reduceMotion = useReduceMotion();
  const [sweep] = useState(() => new Animated.Value(0));
  const [sweeping, setSweeping] = useState(false);
  const toggleCompleted = () => {
    if (sweeping) return;
    if (completed || reduceMotion) return actions.onToggleCompleted();
    setSweeping(true);
    sweep.setValue(0);
    Animated.timing(sweep, { toValue: 1, duration: 520, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }).start(() => {
      actions.onToggleCompleted();
      setSweeping(false);
    });
  };
  const sweepLayer = sweeping ? <CompletionSweep progress={sweep} /> : null;
  const [sheet, setSheet] = useState<'edit' | 'rename' | 'details' | null>(null);
  const edited = deadline.editedAt ? ' · edited' : '';
  const worth = gradeWeightLabel(deadline.gradeWeight);

  const sheets = (
    <>
      {editsAll ? (
        <DeadlineForm
          visible={sheet === 'edit'}
          editing={{ deadline, standing }}
          confirms={moderation.canVerify}
          onClose={() => setSheet(null)}
          onSubmit={actions.onEdit}
        />
      ) : null}
      {isMine ? null : (
        <RenameSheet
          visible={sheet === 'rename'}
          deadline={deadline}
          onClose={() => setSheet(null)}
          onSave={actions.onRename}
        />
      )}
      <DetailsSheet
        visible={sheet === 'details'}
        deadline={deadline}
        onClose={() => setSheet(null)}
        onSave={actions.onSaveDetails}
        onReport={actions.onReportDetails}
      />
    </>
  );
  const detailsBlock = (
    <DetailsBlock
      deadline={deadline}
      problem={detailsProblem}
      reported={detailsReported}
      editsAll={editsAll}
      onEdit={() => setSheet(editsAll ? 'edit' : 'details')}
    />
  );
  const standingLine = (
    <StandingLine
      deadline={deadline}
      standing={standing}
      isMine={isMine}
      canVerify={moderation.canVerify}
      completed={completed}
      actions={{ ...actions, onToggleCompleted: toggleCompleted }}
      onRename={() => setSheet('rename')}
    />
  );

  if (variant === 'schedule') {
    const graded = deadline.gradeWeight > 0 ? ` · ${deadline.gradeWeight}%` : '';
    const done = theme.tint.confirmed;
    return (
      <View
        style={[
          styles.item,
          completed
            ? { backgroundColor: withAlpha(done, 0.14), borderColor: withAlpha(done, 0.5) }
            : { backgroundColor: theme.canvas, borderColor: theme.separator },
        ]}
      >
        <View style={[styles.accentBar, { backgroundColor: completed ? done : deadlineTint(deadline.kind, theme) }]} />
        <View style={styles.itemBody}>
          <View style={styles.itemTop}>
            <Txt type="subheadline" color={completed ? done : undefined} style={[styles.semibold, styles.text]}>{displayTitle(deadline)}</Txt>
            <Txt type="footnote" color={theme.inkSecondary} style={styles.tabular}>{formatTime(deadline.due)}</Txt>
          </View>
          {/* Your own name for it would otherwise hide what classmates are talking about. */}
          {deadline.myLabel ? <Txt type="caption" color={theme.inkTertiary}>Shared as “{deadline.title}”</Txt> : null}
          <Txt type="footnote" color={theme.inkSecondary}>
            {moduleName ?? deadline.moduleKey} · {deadlineKindLabel(deadline.kind)}{graded}{showDate ? '' : edited}
          </Txt>
          {showDate ? <Txt type="footnote" color={theme.inkSecondary}>{formatWeekdayDayMonthTime(deadline.due)}{edited}</Txt> : null}
          {detailsBlock}
          <View style={[styles.divider, styles.itemDivider, { backgroundColor: theme.separator }]} />
          {standingLine}
        </View>
        {sweepLayer}
        {sheets}
      </View>
    );
  }

  return (
    <Row>
      <View style={[styles.rowBody, styles.sweepable]}>
        <AdaptiveStack gap={Space.m}>
          <View style={styles.kindIcon} importantForAccessibility="no" accessibilityElementsHidden>
            <Icon name={completed ? 'confirmed' : deadlineKindIcon(deadline.kind)} color={completed ? theme.tint.confirmed : theme.inkSecondary} />
          </View>
          <View style={styles.text}>
            <Txt type="body" color={completed ? theme.tint.confirmed : undefined}>{displayTitle(deadline)}</Txt>
            {deadline.myLabel ? <Txt type="caption" color={theme.inkTertiary}>Shared as “{deadline.title}”</Txt> : null}
            <Txt type="caption" color={theme.inkSecondary}>{deadlineKindLabel(deadline.kind)}, due {formatAbbreviated(deadline.due)} · {worth}{edited}</Txt>
          </View>
          <Txt type="caption" color={theme.inkSecondary} style={styles.medium}>{deadlineCountdown(deadline.due)}</Txt>
        </AdaptiveStack>
        <View style={large ? undefined : styles.indent}>{detailsBlock}</View>
        <View style={large ? undefined : styles.indent}>{standingLine}</View>
        {sweepLayer}
      </View>
      {sheets}
    </Row>
  );
}

/**
 * How far it's trusted, and what this student can do about it. One unverified person's date
 * is worth less than three people's, and the row says which.
 */
function StandingLine({
  deadline, standing, isMine, canVerify, completed, actions, onRename,
}: {
  deadline: Deadline;
  standing: DeadlineStanding;
  isMine: boolean;
  canVerify: boolean;
  completed: boolean;
  actions: DeadlineActions;
  onRename: () => void;
}) {
  const theme = useTheme();
  const trust = deadlineTrust(deadline, standing);
  const dispute = standing.disputeSummary;
  return (
    // The trust line on its own, then the buttons: three of them beside it squeeze it to a word a line.
    <View style={styles.standing}>
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
        <View style={[styles.actions, styles.standingActions]}>
          <CompletedButton completed={completed} onPress={actions.onToggleCompleted} />
          {canVerify ? <VerifyButton deadline={deadline} onPress={actions.onVerify} /> : null}
          <InlineAction title="Delete" tint={theme.destructive} onPress={actions.onDelete} />
        </View>
      ) : (
        <View style={[styles.actions, styles.standingActions]}>
          <CompletedButton completed={completed} onPress={actions.onToggleCompleted} />
          {canVerify ? (
            // A moderator's word settles it, so it takes the place of the crowd's "This is right".
            <VerifyButton deadline={deadline} onPress={actions.onVerify} />
          ) : standing.disputedByMe ? (
            // Tapping takes it back, the way "Confirmed" does.
            <InlineAction title="You said it's wrong" tint={theme.tint.off} onPress={actions.onDispute} />
          ) : (
            <InlineAction
              title={standing.confirmedByMe ? 'Confirmed' : 'This is right'}
              tint={standing.confirmedByMe ? theme.tint.confirmed : theme.accent}
              onPress={actions.onConfirm}
            />
          )}
          <MoreMenu deadline={deadline} standing={standing} actions={actions} onRename={onRename} />
        </View>
      )}
    </View>
  );
}

/** "Mark done", then "Completed" — green either way. Pressing "Completed" unticks it. */
function CompletedButton({ completed, onPress }: { completed: boolean; onPress: () => void }) {
  const theme = useTheme();
  return <InlineAction title={completed ? 'Completed' : 'Mark done'} tint={theme.tint.confirmed} onPress={onPress} />;
}

/**
 * The green wash Mark done leaves behind, drawn left to right with a tick riding its leading
 * edge. The edge fades as it reaches the far side, so the row lands on its completed colours.
 */
function CompletionSweep({ progress }: { progress: Animated.Value }) {
  const theme = useTheme();
  const done = theme.tint.confirmed;
  const width = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  const edge = progress.interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 1, 0] });
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Animated.View style={[styles.sweepWash, { width, backgroundColor: withAlpha(done, 0.14) }]}>
        <Animated.View style={[styles.sweepEdge, { opacity: edge, backgroundColor: withAlpha(done, 0.35) }]}>
          <Icon name="check" size={16} color={done} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

/** "Confirm", or "Confirmed" once a moderator has — tapping it again takes that back. */
function VerifyButton({ deadline, onPress }: { deadline: Deadline; onPress: () => void }) {
  const theme = useTheme();
  const verified = deadline.status === 'verified';
  return (
    <InlineAction
      title={verified ? 'Confirmed' : 'Confirm'}
      tint={verified ? theme.tint.confirmed : theme.accent}
      onPress={onPress}
    />
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

/**
 * The shared Details box on a row: the text and how long ago it changed, or a quiet way to
 * start it. Tapping either opens the editor, which is everyone's, not only the poster's.
 */
function DetailsBlock({ deadline, problem, reported, editsAll, onEdit }: {
  deadline: Deadline;
  problem: string | null;
  reported: boolean;
  /** Opens the whole deadline's form rather than the details alone. */
  editsAll: boolean;
  onEdit: () => void;
}) {
  const theme = useTheme();
  const now = useNow();
  return (
    <View style={styles.details}>
      {deadline.details ? (
        <>
          <Pressable onPress={onEdit} accessibilityRole="button" accessibilityLabel={`Details: ${deadline.details}`} accessibilityHint={editsAll ? 'Edits the deadline' : 'Edits the details'}>
            <Txt type="footnote" numberOfLines={4}>{deadline.details}</Txt>
          </Pressable>
          <View style={styles.detailsLine}>
            {deadline.detailsEditedAt ? (
              <Txt type="caption2" color={theme.inkSecondary} style={styles.text}>{detailsEditedLabel(deadline.detailsEditedAt, now)}</Txt>
            ) : <View style={styles.text} />}
            <InlineAction title={editsAll ? 'Edit' : 'Edit details'} onPress={onEdit} />
          </View>
        </>
      ) : (
        <Pressable onPress={onEdit} accessibilityRole="button" accessibilityLabel="Add details" hitSlop={{ top: 6, bottom: 6 }} style={({ pressed }) => [styles.addDetails, pressed && { opacity: 0.6 }]}>
          <Label icon="edit" text="Add details" type="footnote" color={theme.inkSecondary} />
        </Pressable>
      )}
      {problem ? (
        <Txt type="caption" color={theme.tint.off}>{problem}</Txt>
      ) : reported ? (
        <Txt type="caption" color={theme.inkSecondary}>Reported. A moderator will look at the details.</Txt>
      ) : null}
    </View>
  );
}

/**
 * Editing the details. Saved as soon as Save is pressed — the row shows the new text at
 * once, and the old text back with the reason if the server says no.
 */
function DetailsSheet({ visible, deadline, onClose, onSave, onReport }: {
  visible: boolean;
  deadline: Deadline;
  onClose: () => void;
  onSave: (text: string) => void;
  onReport: () => void;
}) {
  const theme = useTheme();
  const [text, setText] = useState(deadline.details);
  // Refilled each time it opens, so it starts from what's saved now, someone else's edit included.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setText(deadline.details);
  }
  const problem = DeadlineRules.detailsProblem(text);
  const left = DETAILS_LIMIT - text.trim().length;
  const unchanged = text.trim() === deadline.details;

  return (
    <Sheet
      visible={visible}
      title="Details"
      onClose={onClose}
      left={<BarButton title="Cancel" onPress={onClose} />}
      right={
        <BarButton
          title="Save"
          bold
          disabled={problem !== null || unchanged}
          onPress={() => {
            onSave(text);
            onClose();
          }}
        />
      }
    >
      <ListScroll>
        <Section footer="Anyone taking this module can edit these, on anyone's deadline. Earlier versions are kept, so a moderator can put back anything spoiled.">
          <Row>
            <TextInput
              value={text}
              onChangeText={setText}
              multiline
              maxLength={DETAILS_LIMIT}
              placeholder="What to hand in, where, and anything the brief doesn't say"
              placeholderTextColor={theme.inkTertiary}
              style={[styles.input, styles.detailsInput, { color: theme.ink }]}
              accessibilityLabel="Details"
              textAlignVertical="top"
              autoFocus
            />
            {problem ? (
              <Txt type="caption" color={theme.tint.off}>{problem}</Txt>
            ) : left < 20 ? (
              <Txt type="caption" color={theme.inkSecondary}>{left === 1 ? '1 character left' : `${left} characters left`}</Txt>
            ) : null}
          </Row>
        </Section>
        {deadline.details ? (
          <Section>
            <ActionRow
              title="Report these details"
              icon="flag"
              onPress={() => {
                onReport();
                onClose();
              }}
            />
          </Section>
        ) : null}
      </ListScroll>
    </Sheet>
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
 * Adding a deadline, or the poster editing theirs: a title, what it is, when it's due, how
 * much of the grade it's worth, and the shared details. Added from the Deadlines tab, where
 * no class says which module it's for, it also asks for the module first (and, if it's for
 * one class only, which), and takes the student's own name for it last.
 */
export function DeadlineForm({
  visible, onClose, onSubmit, editing, confirms = false, defaultDue, modules, defaultModule,
}: {
  visible: boolean;
  onClose: () => void;
  /** `placement` is only given when the form chose the module itself (`modules`). */
  onSubmit: (fields: DeadlineFields, details: string, placement?: DeadlinePlacement) => void;
  editing?: { deadline: Deadline; standing: DeadlineStanding };
  /** A moderator's edit: saving it confirms the deadline for everyone. */
  confirms?: boolean;
  /** Where a new one's date starts — the class it's added from. A week out when there's no class. */
  defaultDue?: Date;
  /** The student's modules to choose from, on the Deadlines tab. A class page knows its own. */
  modules?: ModuleChoice[];
  /** The module picked when it opens, such as the one the tab is showing. */
  defaultModule?: string | null;
}) {
  const theme = useTheme();
  const initial = editing?.deadline;
  const choosing = !!modules && !editing;
  const firstModule = () => (modules?.length === 1 ? modules[0].key : defaultModule ?? null);
  const [moduleKey, setModuleKey] = useState<string | null>(null);
  const [atGroupKey, setAtGroupKey] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  // An empty title is only called a problem once the student has been in the box.
  const [titleTouched, setTitleTouched] = useState(false);
  const [kind, setKind] = useState<DeadlineKind>('assignment');
  const [due, setDue] = useState(() => addDays(new Date(), 7));
  // Kept as typed; blank is 0, which is not graded.
  const [weightText, setWeightText] = useState('');
  const [label, setLabel] = useState('');
  const [details, setDetails] = useState('');
  const detailsProblem = DeadlineRules.detailsProblem(details);
  const weight = DeadlineRules.parseGradeWeight(weightText);
  const now = useNow();
  const problems = DeadlineRules.draftProblems(
    { moduleKey: choosing ? moduleKey : initial?.moduleKey ?? '', title, due, weightText, label: choosing ? label : '' },
    now,
  );
  const valid = Object.keys(problems).length === 0 && !detailsProblem;
  const chosen = modules?.find((m) => m.key === moduleKey) ?? null;
  const moduleButton = useRef<View>(null);
  const [pickingModule, setPickingModule] = useState(false);

  // Filled in each time it opens, so an edit starts from what's saved now, not at first render.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setModuleKey(firstModule());
      setAtGroupKey(null);
      setTitle(initial?.title ?? '');
      setTitleTouched(false);
      setKind(initial?.kind ?? 'assignment');
      setDue(initial?.due ?? defaultDue ?? addDays(new Date(), 7));
      setWeightText(initial && initial.gradeWeight > 0 ? String(initial.gradeWeight) : '');
      setLabel('');
      setDetails(initial?.details ?? '');
    }
  }

  const chip = (selected: boolean, onPress: () => void, content: ReactNode, key: string) => (
    <Pressable
      key={key}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[styles.kind, { backgroundColor: selected ? theme.accent : theme.raised }]}
    >
      {content}
    </Pressable>
  );

  return (
    <Sheet
      visible={visible}
      title={editing ? 'Edit deadline' : 'Add a deadline'}
      onClose={onClose}
      left={<BarButton title="Cancel" onPress={onClose} />}
      right={
        <BarButton
          title={editing ? 'Confirm' : 'Add'}
          bold
          disabled={!valid}
          onPress={() => {
            if (weight === null) return;
            const fields = { title: title.trim(), kind, due, gradeWeight: weight };
            if (choosing && moduleKey) onSubmit(fields, details.trim(), { moduleKey, atGroupKey, label });
            else onSubmit(fields, details.trim());
            onClose();
          }}
        />
      }
    >
      <ListScroll>
        <Section footer={editing ? editFooter(editing, kind, due, confirms) : 'Everyone taking this module will see this.'}>
          {choosing ? (
            <Row>
              <View style={styles.dueRow}>
                <Txt type="footnote" color={theme.inkSecondary}>Module</Txt>
                <View ref={moduleButton} collapsable={false} style={styles.moduleButton}>
                  <InlineAction title={chosen?.name ?? 'Choose'} onPress={() => setPickingModule(true)} />
                </View>
              </View>
              {problems.module ? <Txt type="caption" color={theme.inkSecondary}>{problems.module}</Txt> : null}
              <DropdownMenu
                visible={pickingModule}
                anchor={moduleButton}
                onClose={() => setPickingModule(false)}
                actions={(modules ?? []).map((m) => ({
                  label: m.name,
                  selected: m.key === moduleKey,
                  onPress: () => {
                    // A class belongs to its module, so a new module starts module-wide.
                    if (m.key !== moduleKey) setAtGroupKey(null);
                    setModuleKey(m.key);
                  },
                }))}
              />
            </Row>
          ) : null}
          {choosing && chosen && chosen.classes.length > 0 ? (
            <Row>
              <Txt type="footnote" color={theme.inkSecondary} style={styles.fieldLabel}>Class</Txt>
              <View style={styles.kinds}>
                {chip(atGroupKey === null, () => setAtGroupKey(null),
                  <Txt type="footnote" color={atGroupKey === null ? theme.onAccent : theme.ink}>Whole module</Txt>, 'all')}
                {chosen.classes.map((c) => chip(c.groupKey === atGroupKey, () => setAtGroupKey(c.groupKey),
                  <Txt type="footnote" color={c.groupKey === atGroupKey ? theme.onAccent : theme.ink}>{c.label}</Txt>, c.groupKey))}
              </View>
              <Txt type="caption" color={theme.inkTertiary} style={styles.fieldNote}>
                {"If it's due at one class, pick it: that class shows it first. Every class in the module still lists it."}
              </Txt>
            </Row>
          ) : null}
          <Row>
            <TextInput
              value={title}
              onChangeText={setTitle}
              onBlur={() => setTitleTouched(true)}
              maxLength={TITLE_LIMIT}
              placeholder="What's due?"
              placeholderTextColor={theme.inkTertiary}
              style={[styles.input, { color: theme.ink }]}
              accessibilityLabel="What's due?"
              returnKeyType="done"
            />
            {titleTouched && problems.title ? <Txt type="caption" color={theme.tint.off}>{problems.title}</Txt> : null}
          </Row>
          <Row>
            <Txt type="footnote" color={theme.inkSecondary} style={styles.fieldLabel}>Type</Txt>
            <View style={styles.kinds}>
              {DEADLINE_KINDS.map((k) => chip(k === kind, () => setKind(k),
                <Label icon={deadlineKindIcon(k)} text={deadlineKindLabel(k)} type="footnote" color={k === kind ? theme.onAccent : theme.ink} />, k))}
            </View>
          </Row>
          <Row>
            <View style={styles.dueRow}>
              <Txt type="footnote" color={theme.inkSecondary}>Due</Txt>
              <DuePicker value={due} onChange={setDue} />
            </View>
            {problems.due ? (
              <Txt type="caption" color={theme.tint.off}>{problems.due}</Txt>
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
              <Txt type="footnote" color={problems.weight ? theme.tint.off : theme.inkSecondary} style={styles.weightReadout}>
                {problems.weight ?? gradeWeightLabel(weight ?? 0)}
              </Txt>
            </View>
          </Row>
          <Row>
            <Txt type="footnote" color={theme.inkSecondary} style={styles.fieldLabel}>Details</Txt>
            <TextInput
              value={details}
              onChangeText={setDetails}
              multiline
              maxLength={DETAILS_LIMIT}
              placeholder="Where to hand it in, what the brief leaves out"
              placeholderTextColor={theme.inkTertiary}
              style={[styles.input, styles.detailsInput, { color: theme.ink }]}
              accessibilityLabel="Details"
            />
            <Txt type="caption" color={detailsProblem ? theme.tint.off : theme.inkTertiary}>
              {detailsProblem ?? 'Optional. Anyone taking the module can change these.'}
            </Txt>
          </Row>
          {choosing ? (
            <Row>
              <Txt type="footnote" color={theme.inkSecondary} style={styles.fieldLabel}>Your name for it</Txt>
              <TextInput
                value={label}
                onChangeText={setLabel}
                maxLength={LABEL_LIMIT}
                placeholder={title.trim() || 'Optional'}
                placeholderTextColor={theme.inkTertiary}
                style={[styles.input, { color: theme.ink }]}
                accessibilityLabel="Your name for this deadline"
                returnKeyType="done"
              />
              <Txt type="caption" color={problems.label ? theme.tint.off : theme.inkTertiary}>
                {problems.label ?? 'Only you see this name. Everyone else sees the title.'}
              </Txt>
            </Row>
          ) : null}
        </Section>
      </ListScroll>
    </Sheet>
  );
}

/** What saving will cost, said before it's spent: other people's vouches, or a verification. */
function editFooter(
  { deadline, standing }: { deadline: Deadline; standing: DeadlineStanding }, kind: DeadlineKind, due: Date, confirms: boolean,
): string {
  const parts = ['Everyone taking this module sees the change.'];
  // The poster's own vouch survives their edit, so it isn't counted as lost.
  const others = standing.confirmCount - (standing.confirmedByMe ? 1 : 0);
  if (others > 0 && DeadlineRules.editClearsConfirmations(deadline, kind, due)) {
    parts.push(others === 1
      ? "Changing the date or type clears the other person's confirmation — they vouched for the old one."
      : `Changing the date or type clears the ${others} other confirmations — they vouched for the old one.`);
  }
  if (confirms) parts.push('Confirming marks it as confirmed by a moderator.');
  else if (deadline.status === 'verified') parts.push('It goes back to waiting on a moderator.');
  return parts.join(' ');
}

const styles = StyleSheet.create({
  // Room between what it is and how far it's trusted, so the two read as two lines of thought.
  rowBody: { gap: Space.s },
  item: { flexDirection: 'row', borderRadius: Radius.control, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  accentBar: { width: 3 },
  itemBody: { flex: 1, paddingHorizontal: Space.m, paddingTop: Space.s, gap: Space.xxs },
  itemTop: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.s },
  itemDivider: { marginTop: Space.xs },
  semibold: { fontWeight: '600' },
  tabular: { fontVariant: ['tabular-nums'], marginTop: 1 },
  divider: { height: StyleSheet.hairlineWidth },
  kindIcon: { width: 22, alignItems: 'center' },
  text: { flex: 1, gap: Space.xxs },
  medium: { fontWeight: '500' },
  indent: { marginLeft: 22 + Space.m },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  standing: { gap: Space.xs },
  sweepable: { overflow: 'hidden' },
  sweepWash: { position: 'absolute', top: 0, bottom: 0, left: 0 },
  sweepEdge: { position: 'absolute', top: 0, bottom: 0, right: 0, width: 28, alignItems: 'center', justifyContent: 'center' },
  standingActions: { justifyContent: 'flex-end', flexWrap: 'wrap' },
  moreButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  input: { fontSize: 17, minHeight: 40 },
  fieldLabel: { marginBottom: Space.xs },
  fieldNote: { marginTop: Space.xs },
  moduleButton: { flexShrink: 1 },
  dueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.m },
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s },
  kind: { borderRadius: 8, paddingHorizontal: Space.m, paddingVertical: Space.s },
  weight: { flexDirection: 'row', alignItems: 'center', gap: Space.s },
  weightInput: { width: 64, borderRadius: 8, paddingHorizontal: Space.m, textAlign: 'right' },
  weightReadout: { flex: 1, marginLeft: Space.s },
  details: { gap: Space.xxs, marginTop: Space.xs },
  detailsLine: { flexDirection: 'row', alignItems: 'center', gap: Space.s },
  addDetails: { alignSelf: 'flex-start', minHeight: 28, justifyContent: 'center' },
  detailsInput: { minHeight: 72 },
});
