import { ReactNode, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, TextInput, View } from 'react-native';
import {
  ABUSE_REPORT_REASONS, Deadline, deadlineCountdown, DeadlineFields, DEADLINE_KINDS, DeadlineKind, deadlineKindLabel,
  DeadlinePlacement, DeadlineReportReason, DeadlineRules, DeadlineStanding, deadlineTrust, DETAILS_LIMIT, detailsEditedLabel,
  displayTitle, LABEL_LIMIT, ModuleChoice, reportReasonLabel, gradeWeightLabel, TITLE_LIMIT,
} from '../../core/deadline';
import { addDays, formatWeekdayDayMonthTime } from '../../core/time';
import {
  ActionRow, ActionSheet, AppSwitch, Avatar, BarButton, Icon, InlineAction, Label, ListScroll, Row, Section, Sheet, Txt,
} from '../../ui/components';
import { DropdownMenu } from '../../ui/DropdownMenu';
import { deadlineKindIcon, deadlineTint } from '../../ui/meaning';
import { useNow } from '../../state/hooks';
import { elevation, moduleTint, Radius, Space, useTheme, withAlpha } from '../../ui/theme';
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

/** Two letters for a module's badge: "Maths for Computing" → "MC", "CA116" → "CA". */
export function moduleInitials(name: string): string {
  const words = name.split(/[\s&/-]+/).filter((w) => /^[A-Za-z]/.test(w) && !/^(and|for|of|in|the|to|a)$/i.test(w));
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0] ?? name).slice(0, 2).toUpperCase();
}

/**
 * The green wash a tick leaves behind, drawn left to right with a tick riding its leading
 * edge. The edge fades as it reaches the far side, so the card lands on its completed colours.
 */
export function CompletionSweep({ progress }: { progress: Animated.Value }) {
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

/**
 * A deadline opened from its card: everything about it, and everything this person may do to
 * it — as a classmate, as its poster, or as a moderator or administrator — in one sheet, laid
 * out as Notra lists its settings. Closes itself when the deadline goes (deleted, or reported
 * and so hidden).
 */
export function DeadlineSheet({
  deadline, moduleName, standing, isMine, moderation, completed, actions, detailsProblem, detailsReported, onClose,
}: {
  /** Null closes it. */
  deadline: Deadline | null;
  moduleName: string;
  standing: DeadlineStanding | null;
  isMine: boolean;
  moderation: Moderation;
  completed: boolean;
  actions: DeadlineActions;
  /** Why the last save of the details didn't stick. */
  detailsProblem: string | null;
  detailsReported: boolean;
  onClose: () => void;
}) {
  const theme = useTheme();
  const now = useNow();
  const [sheet, setSheet] = useState<'edit' | 'rename' | 'details' | 'reasons' | 'hide' | 'delete' | null>(null);
  // Kept while the sheet slides away after the deadline has gone, so it doesn't empty mid-slide.
  const [kept, setKept] = useState<{ deadline: Deadline; standing: DeadlineStanding } | null>(null);
  if (deadline && standing && kept?.deadline !== deadline) setKept({ deadline, standing });
  const shown = deadline && standing ? { deadline, standing } : kept;
  if (!shown) return null;
  const d = shown.deadline;
  const editsAll = canEdit(moderation, isMine);
  const trust = deadlineTrust(d, shown.standing);
  const dispute = shown.standing.disputeSummary;
  const kindTint = deadlineTint(d.kind, theme);
  const done = theme.tint.confirmed;

  return (
    <Sheet visible={deadline !== null} title="Deadline" onClose={onClose} right={<BarButton title="Done" bold onPress={onClose} />}>
      <ListScroll>
        {/* What it is and when, as the card on the list shows it, larger. */}
        <View style={[styles.hero, { backgroundColor: theme.surface }, elevation(theme)]}>
          <View style={styles.heroTop}>
            <View style={[styles.kindChip, { backgroundColor: withAlpha(kindTint, 0.14) }]}>
              <Icon name={deadlineKindIcon(d.kind)} size={13} color={kindTint} />
              <Txt type="caption" color={kindTint} style={styles.semibold}>{deadlineKindLabel(d.kind)}</Txt>
            </View>
            {completed ? (
              <View style={[styles.kindChip, { backgroundColor: withAlpha(done, 0.14) }]}>
                <Icon name="check" size={13} color={done} />
                <Txt type="caption" color={done} style={styles.semibold}>Completed</Txt>
              </View>
            ) : null}
          </View>
          <Txt type="title3" style={styles.bold}>{displayTitle(d)}</Txt>
          {d.myLabel ? <Txt type="footnote" color={theme.inkTertiary}>Shared as “{d.title}”</Txt> : null}
          <View style={styles.moduleLine}>
            <Avatar text={moduleInitials(moduleName)} color={moduleTint(theme, d.moduleKey)} size={26} />
            <Txt type="subheadline" color={theme.inkSecondary} style={styles.flex}>{moduleName}</Txt>
          </View>
          <View style={[styles.divider, { backgroundColor: theme.separator }]} />
          <View style={styles.dueLine}>
            <Txt type="subheadline" style={styles.semibold}>{formatWeekdayDayMonthTime(d.due)}</Txt>
            <Txt type="subheadline" color={theme.accent} style={styles.semibold}>{deadlineCountdown(d.due, now)}</Txt>
          </View>
          <Txt type="footnote" color={theme.inkSecondary}>{gradeWeightLabel(d.gradeWeight)}{d.editedAt ? ' · edited' : ''}</Txt>
        </View>

        <Section header="Details" footer={detailsProblem ?? (detailsReported ? 'Reported. A moderator will look at the details.' : undefined)}>
          {d.details ? (
            <Row>
              <Txt type="callout">{d.details}</Txt>
              {d.detailsEditedAt ? <Txt type="caption" color={theme.inkTertiary}>{detailsEditedLabel(d.detailsEditedAt, now)}</Txt> : null}
            </Row>
          ) : null}
          <ActionRow
            title={editsAll ? 'Edit deadline' : d.details ? 'Edit details' : 'Add details'}
            icon="edit"
            chevron
            onPress={() => setSheet(editsAll ? 'edit' : 'details')}
          />
        </Section>

        <Section header="Is it right?">
          <Row>
            {d.isPrivate ? (
              <Label icon="hide" text="Only you can see this" type="subheadline" color={theme.inkSecondary} />
            ) : trust === 'verified' ? (
              <Label icon="confirmed" text="Confirmed by a moderator" type="subheadline" color={done} />
            ) : (
              <Label icon={trust === 'confirmed' ? 'confirmed' : 'unconfirmed'} text={shown.standing.summary} type="subheadline" color={trust === 'confirmed' ? done : theme.inkSecondary} />
            )}
            {dispute ? <Label icon="warning" text={dispute} type="footnote" color={trust === 'disputed' ? theme.tint.off : theme.inkSecondary} /> : null}
          </Row>
          {moderation.canVerify && !d.isPrivate ? (
            // A moderator's word settles it, so it takes the place of the crowd's "This is right".
            <ActionRow
              title={d.status === 'verified' ? 'Remove the moderator confirmation' : 'Confirm for everyone'}
              icon="confirmed"
              tint={done}
              onPress={actions.onVerify}
            />
          ) : null}
          {!isMine && !moderation.canVerify && !d.isPrivate ? (
            shown.standing.disputedByMe ? (
              <ActionRow title="It's right after all" icon="confirmed" tint={done} onPress={actions.onConfirm} />
            ) : (
              <ActionRow
                title={shown.standing.confirmedByMe ? 'You confirmed it — tap to take back' : 'This is right'}
                icon="confirmed"
                tint={done}
                onPress={actions.onConfirm}
              />
            )
          ) : null}
          {!isMine && !d.isPrivate && !shown.standing.disputedByMe ? (
            <ActionRow title="The date or details are wrong" icon="warning" tint={theme.tint.off} onPress={actions.onDispute} />
          ) : null}
        </Section>

        <Section header="For you">
          <ActionRow
            title={completed ? 'Mark as not done' : 'Mark as done'}
            icon={completed ? 'undo' : 'check'}
            tint={done}
            onPress={actions.onToggleCompleted}
          />
          {isMine ? null : (
            <ActionRow title={d.myLabel ? 'Rename for me' : 'Give it my own name'} icon="edit" chevron onPress={() => setSheet('rename')} />
          )}
        </Section>

        {isMine || !d.isPrivate ? (
          <Section>
            {isMine ? null : <ActionRow title="Report…" icon="flag" chevron onPress={() => setSheet('reasons')} />}
            {isMine ? null : <ActionRow title="Hide posts from this person" icon="hide" destructive onPress={() => setSheet('hide')} />}
            {isMine ? <ActionRow title="Delete deadline" icon="delete" destructive onPress={() => setSheet('delete')} /> : null}
          </Section>
        ) : null}
      </ListScroll>

      {editsAll ? (
        <DeadlineForm
          visible={sheet === 'edit'}
          editing={{ deadline: d, standing: shown.standing }}
          confirms={moderation.canVerify}
          onClose={() => setSheet(null)}
          onSubmit={actions.onEdit}
        />
      ) : null}
      {isMine ? null : <RenameSheet visible={sheet === 'rename'} deadline={d} onClose={() => setSheet(null)} onSave={actions.onRename} />}
      <DetailsSheet visible={sheet === 'details'} deadline={d} onClose={() => setSheet(null)} onSave={actions.onSaveDetails} onReport={actions.onReportDetails} />
      <ActionSheet
        visible={sheet === 'reasons'}
        onClose={() => setSheet(null)}
        title="Why are you reporting this?"
        message="It's hidden from you straight away, and an administrator reviews it within a day. The person who posted it isn't told who reported it. If only the date is wrong, say so instead — it stays up with a warning for everyone."
        actions={ABUSE_REPORT_REASONS.map((reason) => ({ label: reportReasonLabel(reason), onPress: () => actions.onReport(reason) }))}
      />
      <ActionSheet
        visible={sheet === 'hide'}
        onClose={() => setSheet(null)}
        title="Hide posts from this person?"
        message="You won't see any deadline they share. You can show everyone again from Account."
        actions={[{ label: 'Hide their posts', destructive: true, onPress: actions.onHideAuthor }]}
      />
      <ActionSheet
        visible={sheet === 'delete'}
        onClose={() => setSheet(null)}
        title="Delete this deadline?"
        message="It goes for everyone taking the module."
        actions={[{ label: 'Delete', destructive: true, onPress: actions.onDelete }]}
      />
    </Sheet>
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
  // Off unless asked for: a deadline is for the class by default.
  const [isPrivate, setIsPrivate] = useState(false);
  const detailsProblem = DeadlineRules.detailsProblem(details);
  const weight = DeadlineRules.parseGradeWeight(weightText);
  const now = useNow();
  const problems = DeadlineRules.draftProblems(
    { moduleKey: choosing ? moduleKey : initial?.moduleKey ?? '', title, due, weightText, label: choosing && !isPrivate ? label : '' },
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
      setIsPrivate(false);
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
            const fields = { title: title.trim(), kind, due, gradeWeight: weight, ...(!editing && isPrivate ? { isPrivate: true } : {}) };
            // A private one has no shared title for its own name to stand in for.
            if (choosing && moduleKey) onSubmit(fields, details.trim(), { moduleKey, atGroupKey, label: isPrivate ? '' : label });
            else onSubmit(fields, details.trim());
            onClose();
          }}
        />
      }
    >
      <ListScroll>
        <Section
          footer={editing
            ? editFooter(editing, kind, due, confirms)
            : isPrivate ? 'Only you will see this.' : 'Everyone taking this module will see this.'}
        >
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
              {detailsProblem ?? (isPrivate || initial?.isPrivate ? 'Optional.' : 'Optional. Anyone taking the module can change these.')}
            </Txt>
          </Row>
          {choosing && !isPrivate ? (
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
          {editing ? null : (
            <Row>
              <View style={styles.dueRow}>
                <Txt type="footnote" color={theme.inkSecondary} style={styles.text}>Only visible to me</Txt>
                <AppSwitch value={isPrivate} onValueChange={setIsPrivate} accessibilityLabel="Only visible to me" />
              </View>
              <Txt type="caption" color={theme.inkTertiary}>
                {"Kept on this device and never shared, so classmates can't see or confirm it."}
              </Txt>
            </Row>
          )}
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
  semibold: { fontWeight: '600' },
  bold: { fontWeight: '700' },
  flex: { flex: 1 },
  text: { flex: 1, gap: Space.xxs },
  hero: { marginHorizontal: Space.l, marginTop: Space.l, borderRadius: Radius.card, padding: Space.l, gap: Space.s },
  heroTop: { flexDirection: 'row', gap: Space.s },
  kindChip: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, borderRadius: 999, paddingHorizontal: Space.s, paddingVertical: 3 },
  moduleLine: { flexDirection: 'row', alignItems: 'center', gap: Space.s },
  dueLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.s },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: Space.xs },
  sweepWash: { position: 'absolute', top: 0, bottom: 0, left: 0 },
  sweepEdge: { position: 'absolute', top: 0, bottom: 0, right: 0, width: 28, alignItems: 'center', justifyContent: 'center' },
  input: { fontSize: 17, minHeight: 40 },
  fieldLabel: { marginBottom: Space.xs },
  fieldNote: { marginTop: Space.xs },
  moduleButton: { flexShrink: 1 },
  dueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.m },
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s },
  kind: { borderRadius: 999, paddingHorizontal: Space.m, paddingVertical: Space.s },
  weight: { flexDirection: 'row', alignItems: 'center', gap: Space.s },
  weightInput: { width: 64, borderRadius: 8, paddingHorizontal: Space.m, textAlign: 'right' },
  weightReadout: { flex: 1, marginLeft: Space.s },
  detailsInput: { minHeight: 72 },
});
