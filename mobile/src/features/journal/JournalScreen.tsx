import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Deadline, deadlineCountdown, DeadlineRules, DeadlineSchedule, deadlineSectionTitle,
  gradeWeightLabel, LABEL_LIMIT, TITLE_LIMIT,
} from '../../core/deadline';
import { addDays, formatWeekdayDayMonthTime } from '../../core/time';
import { uuid } from '../../core/uuid';
import { PrefKey } from '../../data/storage';
import { useModel, useNow, usePrefJSON, useServices } from '../../state/hooks';
import { useWeekModel } from '../../state/root';
import {
  AdaptiveStack, BarButton, EmptyState, Icon, IconButton, InlineAction, Label, ListScroll,
  PrimaryButton, Row, Section, Sheet, Spinner, Txt, useLargeText,
} from '../../ui/components';
import { DropdownMenu } from '../../ui/DropdownMenu';
import { deadlineKindIcon, deadlineTint } from '../../ui/meaning';
import { Radius, Space, useTheme } from '../../ui/theme';
import { DeadlineRow } from '../deadlines/DeadlineRows';
import { DeadlinesModel } from '../deadlines/DeadlinesModel';
import { DuePicker } from '../deadlines/DuePicker';
import {
  buildJournalEntries, JOURNAL_TASK_TYPES, JournalDeadlineEntry, JournalTaskType,
  journalTaskTypeLabel, journalTypeToDeadlineKind, StoredJournalItem,
} from './journalData';

/**
 * The student's journal: pre-assigned module deadlines alongside assignments added manually
 * on this device, styled in the same clean idiom as the mobile Deadlines screen.
 */
export function JournalScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const services = useServices();
  const week = useModel(useWeekModel());
  const sharedModel = useModel(useMemo(() => new DeadlinesModel(services), [services]));
  const [storedItems, setStoredItems] = usePrefJSON<StoredJournalItem[]>(PrefKey.journalEntries, []);
  const [moduleFilter, setModuleFilter] = useState<string | null>(null);
  const [formState, setFormState] = useState<{ open: boolean; editing?: StoredJournalItem }>({ open: false });

  const modules = week.loadedModuleKeys;

  useFocusEffect(
    useCallback(() => {
      void sharedModel.load(modules);
    }, [sharedModel, modules]),
  );

  const sharedDeadlines = useMemo(
    () => sharedModel.sections.flatMap((s) => s.deadlines),
    [sharedModel.sections],
  );

  const allEntries = useMemo(
    () => buildJournalEntries(sharedDeadlines, storedItems),
    [sharedDeadlines, storedItems],
  );

  const entryByID = useMemo(
    () => new Map<string, JournalDeadlineEntry>(allEntries.map((e) => [e.deadline.id, e])),
    [allEntries],
  );

  const allUpcoming = useMemo(
    () => DeadlineRules.upcoming(allEntries.map((e) => e.deadline)),
    [allEntries],
  );

  const availableModules = useMemo(() => {
    const keys = new Set<string>([...modules, ...allUpcoming.map((d) => d.moduleKey)]);
    const list = [...keys]
      .map((key) => ({ key, name: key === 'Personal' ? 'Personal' : week.moduleName(key) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!list.some((m) => m.key === 'Personal')) {
      list.push({ key: 'Personal', name: 'Personal' });
    }
    return list;
  }, [modules, allUpcoming, week]);

  const activeFilter = moduleFilter && availableModules.some((m) => m.key === moduleFilter) ? moduleFilter : null;

  const sections = useMemo(() => {
    const filtered = activeFilter ? allUpcoming.filter((d) => d.moduleKey === activeFilter) : allUpcoming;
    return DeadlineSchedule.grouped(filtered);
  }, [allUpcoming, activeFilter]);

  const total = sections.reduce((n, s) => n + s.deadlines.length, 0);
  const manualCount = sections
    .flatMap((s) => s.deadlines)
    .filter((d) => entryByID.get(d.id)?.isManual).length;

  const filterButton = useRef<View>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterTitle = activeFilter
    ? activeFilter === 'Personal'
      ? 'Personal'
      : week.moduleName(activeFilter)
    : 'All modules';

  const saveManual = (
    fields: {
      moduleKey: string;
      title: string;
      taskType: JournalTaskType;
      customType: string;
      due: Date;
      gradeWeight: number;
    },
    editingID?: string,
  ) => {
    const kind = journalTypeToDeadlineKind(fields.taskType);
    const customTrimmed = fields.taskType === 'other' ? fields.customType.trim() : '';
    if (editingID) {
      setStoredItems(
        storedItems.map((item) =>
          item.id === editingID
            ? {
                ...item,
                moduleKey: fields.moduleKey,
                title: fields.title,
                kind,
                taskType: fields.taskType,
                customType: customTrimmed || undefined,
                due: fields.due.toISOString(),
                gradeWeight: fields.gradeWeight,
              }
            : item,
        ),
      );
    } else {
      const next: StoredJournalItem = {
        id: `journal-${uuid()}`,
        moduleKey: fields.moduleKey,
        title: fields.title,
        kind,
        taskType: fields.taskType,
        customType: customTrimmed || undefined,
        due: fields.due.toISOString(),
        gradeWeight: fields.gradeWeight,
        createdAt: new Date().toISOString(),
      };
      setStoredItems([...storedItems, next]);
    }
  };

  const deleteManual = (id: string) => {
    setStoredItems(storedItems.filter((item) => item.id !== id));
  };

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + Space.s, borderBottomColor: theme.separator }]}>
      <View style={styles.headerSide}>
        <IconButton icon="arrowLeft" label="Back to calendar" onPress={() => router.push('/')} />
      </View>
      <View style={styles.headerCenter}>
        <Txt type="headline" accessibilityRole="header">Journal</Txt>
        {allUpcoming.length === 0 ? null : (
          <View ref={filterButton} collapsable={false} style={styles.filter}>
            <Pressable
              onPress={() => setFilterOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={`Showing ${filterTitle}`}
              accessibilityHint="Choose a module"
              hitSlop={10}
              style={({ pressed }) => [styles.filterLabel, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Txt type="caption" color={theme.accent} numberOfLines={1} style={styles.shrink}>{filterTitle}</Txt>
              <Icon name="dropdown" size={14} color={theme.accent} />
            </Pressable>
          </View>
        )}
      </View>
      <View style={[styles.headerSide, styles.headerRight]}>
        <BarButton title="+ Add" bold onPress={() => setFormState({ open: true })} />
      </View>
      <DropdownMenu
        visible={filterOpen}
        anchor={filterButton}
        align="center"
        onClose={() => setFilterOpen(false)}
        actions={[
          { label: 'All modules', selected: activeFilter === null, onPress: () => setModuleFilter(null) },
          ...availableModules.map(({ key, name }) => ({
            label: name,
            selected: activeFilter === key,
            onPress: () => setModuleFilter(key),
          })),
        ]}
      />
    </View>
  );

  const formModal = (
    <JournalForm
      visible={formState.open}
      editing={formState.editing}
      moduleChoices={availableModules}
      onClose={() => setFormState({ open: false })}
      onSubmit={(fields) => saveManual(fields, formState.editing?.id)}
    />
  );

  if (sections.length === 0 && sharedModel.isLoading) {
    return (
      <View style={[styles.fill, { backgroundColor: theme.canvas }]}>
        {header}
        <Spinner />
        {formModal}
      </View>
    );
  }

  if (sections.length === 0) {
    return (
      <View style={[styles.fill, { backgroundColor: theme.canvas }]}>
        {header}
        <EmptyState
          icon="assignment"
          title="Your journal is empty"
          message="Pre-assigned module deadlines and assignments you add yourself will appear here."
          action={<PrimaryButton title="Add an assignment" onPress={() => setFormState({ open: true })} />}
        />
        {formModal}
      </View>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: theme.canvas }]}>
      {header}
      <ListScroll
        refreshing={sharedModel.isLoading}
        onRefresh={() => void sharedModel.reload()}
        footer={
          <View style={[styles.summary, { backgroundColor: theme.surface, borderTopColor: theme.separator }]}>
            <Txt type="caption" color={theme.inkSecondary}>{total} upcoming</Txt>
            {manualCount > 0 ? (
              <Label icon="edit" text={`${manualCount} added by you`} type="caption" color={theme.accent} />
            ) : null}
          </View>
        }
      >
        {sharedModel.errorText ? (
          <Section>
            <Row><Label icon="warning" text={sharedModel.errorText} type="caption" color={theme.inkSecondary} /></Row>
          </Section>
        ) : null}
        {sections.map((group) => (
          <Section key={group.section} header={deadlineSectionTitle(group.section)} bare>
            <View style={styles.cards}>
              {group.deadlines.map((d) => {
                const entry = entryByID.get(d.id);
                const isManual = Boolean(entry?.isManual);
                const moduleName = d.moduleKey === 'Personal' ? 'Personal' : week.moduleName(d.moduleKey);
                return (
                  <View key={d.id} style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.separator }]}>
                    {isManual && entry ? (
                      <ManualJournalRow
                        deadline={d}
                        typeLabel={entry.typeLabel}
                        moduleName={moduleName}
                        onEdit={() => {
                          if (entry.rawManual) setFormState({ open: true, editing: entry.rawManual });
                        }}
                        onDelete={() => deleteManual(d.id)}
                      />
                    ) : (
                      <DeadlineRow
                        deadline={d}
                        moduleName={moduleName}
                        standing={sharedModel.standing(d)}
                        isMine={sharedModel.isMine(d)}
                        variant="schedule"
                        actions={{
                          onConfirm: () => void sharedModel.toggleConfirmation(d),
                          onDispute: () => void sharedModel.toggleDispute(d),
                          onEdit: (fields) => void sharedModel.edit(d, fields),
                          onRename: (label) => void sharedModel.rename(d, label),
                          onDelete: () => void sharedModel.remove(d),
                          onReport: (reason) => void sharedModel.report(d, reason),
                          onHideAuthor: () => void sharedModel.hideAuthor(d),
                        }}
                      />
                    )}
                  </View>
                );
              })}
            </View>
          </Section>
        ))}
      </ListScroll>
      {formModal}
    </View>
  );
}

function ManualJournalRow({
  deadline, typeLabel, moduleName, onEdit, onDelete,
}: {
  deadline: Deadline;
  typeLabel: string;
  moduleName: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const theme = useTheme();
  const large = useLargeText();
  const iconColor = deadlineTint(deadline.kind, theme);
  const worth = gradeWeightLabel(deadline.gradeWeight);

  return (
    <Row>
      <View style={styles.scheduleBody}>
        <AdaptiveStack gap={Space.m} style={styles.top}>
          <View style={styles.titleLine} importantForAccessibility="no" accessibilityElementsHidden>
            <Icon name={deadlineKindIcon(deadline.kind)} color={iconColor} />
          </View>
          <View style={styles.text}>
            <Txt type="headline">{deadline.title}</Txt>
            <Txt type="caption" color={theme.inkSecondary}>
              {moduleName} {typeLabel.toLowerCase()} · {worth}
            </Txt>
            <Txt type="caption" color={theme.inkSecondary}>{formatWeekdayDayMonthTime(deadline.due)}</Txt>
          </View>
          <Txt type="caption" color={theme.inkSecondary} style={[styles.medium, !large && styles.countdown]}>
            {deadlineCountdown(deadline.due)}
          </Txt>
        </AdaptiveStack>

        <View style={[styles.divider, !large && styles.indent, { backgroundColor: theme.separator }]} />

        <AdaptiveStack style={large ? undefined : styles.indent}>
          <View style={styles.text}>
            <Label icon="edit" text="Added by you · Private" type="caption2" color={theme.accent} />
          </View>
          <View style={styles.actions}>
            <InlineAction title="Edit" onPress={onEdit} />
            <InlineAction title="Delete" tint={theme.destructive} onPress={onDelete} />
          </View>
        </AdaptiveStack>
      </View>
    </Row>
  );
}

function JournalForm({
  visible, onClose, onSubmit, editing, moduleChoices,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (fields: {
    moduleKey: string;
    title: string;
    taskType: JournalTaskType;
    customType: string;
    due: Date;
    gradeWeight: number;
  }) => void;
  editing?: StoredJournalItem;
  moduleChoices: { key: string; name: string }[];
}) {
  const theme = useTheme();
  const defaultModule = moduleChoices[0]?.key ?? 'Personal';
  const [moduleKey, setModuleKey] = useState(defaultModule);
  const [title, setTitle] = useState('');
  const [taskType, setTaskType] = useState<JournalTaskType>('homework');
  const [customType, setCustomType] = useState('');
  const [due, setDue] = useState(() => addDays(new Date(), 7));
  const [weightText, setWeightText] = useState('');
  const weight = DeadlineRules.parseGradeWeight(weightText);
  const now = useNow();
  const valid =
    DeadlineRules.isValid(title, due, now) &&
    weight !== null &&
    (taskType !== 'other' || customType.trim().length > 0);

  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setModuleKey(editing?.moduleKey ?? defaultModule);
      setTitle(editing?.title ?? '');
      setTaskType(editing?.taskType ?? 'homework');
      setCustomType(editing?.customType ?? '');
      setDue(editing ? new Date(editing.due) : addDays(new Date(), 7));
      setWeightText(editing && editing.gradeWeight > 0 ? String(editing.gradeWeight) : '');
    }
  }

  return (
    <Sheet
      visible={visible}
      title={editing ? 'Edit assignment' : 'New assignment'}
      onClose={onClose}
      left={<BarButton title="Cancel" onPress={onClose} />}
      right={
        <BarButton
          title={editing ? 'Save' : 'Add'}
          bold
          disabled={!valid}
          onPress={() => {
            if (weight === null) return;
            onSubmit({
              moduleKey,
              title: title.trim(),
              taskType,
              customType: customType.trim(),
              due,
              gradeWeight: weight,
            });
            onClose();
          }}
        />
      }
    >
      <ListScroll>
        <Section footer="Saved in your journal and synced to the Deadlines box on your timetable.">
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
            <Txt type="footnote" color={theme.inkSecondary} style={styles.fieldLabel}>Module</Txt>
            <View style={styles.kinds}>
              {moduleChoices.map((m) => (
                <Pressable
                  key={m.key}
                  onPress={() => setModuleKey(m.key)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: m.key === moduleKey }}
                  style={[styles.kind, { backgroundColor: m.key === moduleKey ? theme.accent : theme.raised }]}
                >
                  <Txt type="footnote" color={m.key === moduleKey ? theme.onAccent : theme.ink}>{m.name}</Txt>
                </Pressable>
              ))}
            </View>
          </Row>
          <Row>
            <Txt type="footnote" color={theme.inkSecondary} style={styles.fieldLabel}>Type</Txt>
            <View style={styles.kinds}>
              {JOURNAL_TASK_TYPES.map((t) => {
                const selected = t === taskType;
                return (
                  <Pressable
                    key={t}
                    onPress={() => setTaskType(t)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    style={[styles.kind, { backgroundColor: selected ? theme.accent : theme.raised }]}
                  >
                    <Label
                      icon={deadlineKindIcon(journalTypeToDeadlineKind(t))}
                      text={journalTaskTypeLabel(t)}
                      type="footnote"
                      color={selected ? theme.onAccent : theme.ink}
                    />
                  </Pressable>
                );
              })}
            </View>
            {taskType === 'other' ? (
              <TextInput
                value={customType}
                onChangeText={setCustomType}
                maxLength={LABEL_LIMIT}
                placeholder="Name this task type (e.g. Lab Report, Essay)..."
                placeholderTextColor={theme.inkTertiary}
                style={[styles.input, styles.customTypeInput, { color: theme.ink, backgroundColor: theme.raised }]}
                accessibilityLabel="Custom task type name"
              />
            ) : null}
          </Row>
          <Row>
            <View style={styles.dueRow}>
              <Txt type="footnote" color={theme.inkSecondary}>Due</Txt>
              <DuePicker value={due} onChange={setDue} />
            </View>
            {due.getTime() <= now.getTime() ? (
              <Txt type="caption" color={theme.tint.off}>That time has passed. Pick a later one.</Txt>
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

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: 44, paddingHorizontal: Space.s, paddingBottom: Space.xs, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerSide: { minWidth: 72, flexDirection: 'row', alignItems: 'center' },
  headerRight: { justifyContent: 'flex-end' },
  headerCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  filter: { maxWidth: '80%' },
  cards: { gap: Space.s },
  card: { borderRadius: Radius.card, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  filterLabel: { flexDirection: 'row', alignItems: 'center', gap: Space.xxs },
  shrink: { flexShrink: 1 },
  summary: { flexDirection: 'row', justifyContent: 'center', gap: Space.l, paddingVertical: Space.s, borderTopWidth: StyleSheet.hairlineWidth },
  scheduleBody: { gap: Space.m },
  top: { alignItems: 'flex-start' },
  titleLine: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  countdown: { marginTop: 3 },
  divider: { height: StyleSheet.hairlineWidth },
  text: { flex: 1, gap: Space.xxs },
  medium: { fontWeight: '500' },
  indent: { marginLeft: 22 + Space.m },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  input: { fontSize: 17, minHeight: 40 },
  customTypeInput: { marginTop: Space.s, borderRadius: 8, paddingHorizontal: Space.m },
  fieldLabel: { marginBottom: Space.xs },
  dueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.m },
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s },
  kind: { borderRadius: 8, paddingHorizontal: Space.m, paddingVertical: Space.s },
  weight: { flexDirection: 'row', alignItems: 'center', gap: Space.s },
  weightInput: { width: 64, borderRadius: 8, paddingHorizontal: Space.m, textAlign: 'right' },
  weightReadout: { flex: 1, marginLeft: Space.s },
});
