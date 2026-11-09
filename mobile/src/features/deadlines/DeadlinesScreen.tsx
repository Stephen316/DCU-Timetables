import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { deadlineSectionTitle, DeadlineRules } from '../../core/deadline';
import { startOfWeek } from '../../core/time';
import { useModel, useNow, useServices } from '../../state/hooks';
import { useWeekModel } from '../../state/root';
import { BarButton, EmptyState, Icon, IconButton, InlineAction, Label, ListScroll, Row, Section, Sheet, Txt } from '../../ui/components';
import { LoadingScreen } from '../../ui/LoadingScreen';
import { DropdownMenu } from '../../ui/DropdownMenu';
import { useTabBarClearance } from '../../ui/floatingBar';
import { CardSwap } from '../../ui/CardSwap';
import { Space, useTheme } from '../../ui/theme';
import { DeadlineCard } from './DeadlineCard';
import { DeadlineForm, DeadlineRow } from './DeadlineRows';
import { canEdit } from './Moderation';
import { DeadlinesModel } from './DeadlinesModel';
import { useTutorial, useTutorialTarget } from '../tutorial/Tutorial';

/**
 * Every assignment, quiz and exam the student's modules have, soonest first. The timetable
 * answers "where am I at 11?"; this answers "what's coming?".
 */
export function DeadlinesScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const clearance = useTabBarClearance();
  const services = useServices();
  const week = useModel(useWeekModel());
  const model = useModel(useMemo(() => new DeadlinesModel(services), [services]));
  /** Modules to ask about, from the timetable that's already loaded. */
  const modules = week.loadedModuleKeys;

  // On every visit, not only when the module list changes: the tab stays mounted behind the
  // timetable, so a deadline added on a class's page — or a load that failed the first time —
  // would otherwise never be fetched again.
  useFocusEffect(
    useCallback(() => {
      // What the timetable already fetched for its outlines fills the tab while this asks.
      void model.load(modules, week.deadlines);
    }, [model, modules, week]),
  );
  // The tutorial has the student open this tab.
  const tutorial = useTutorial();
  useFocusEffect(useCallback(() => tutorial?.signal('deadlinesShown'), [tutorial]));

  // Every module the student takes, not only those with something due: the first deadline
  // for a module has to be addable from here too.
  const moduleOptions = DeadlineRules.moduleChoices([...week.eventsByWeekNumber.values()].flat(), (key) => week.moduleName(key));
  const [adding, setAdding] = useState(false);
  const addButton = useTutorialTarget('addDeadline');

  const filterButton = useRef<View>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const moduleChoices = model.modulesWithDeadlines
    .map((key) => ({ key, name: week.moduleName(key) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const filterTitle = model.moduleFilter ? week.moduleName(model.moduleFilter) : 'All modules';
  // The timetable's week may have been moved on; its label is only this week's when it hasn't.
  const now = useNow();
  const showsThisWeek = !!week.weekLabel && week.weekStart?.getTime() === startOfWeek(now).getTime();

  // A new deadline is announced to a screen reader; it lands in Pending, at the top of its day.
  useEffect(() => {
    const id = model.justAdded;
    if (!id) return;
    const added = model.sections.flatMap((g) => g.deadlines).find((d) => d.id === id);
    if (added) AccessibilityInfo.announceForAccessibility(`Added ${added.title}`);
    // Only a new id is a new arrival; the sections it reads are as they were when it was added.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.justAdded]);

  // Pending and Completed are one list split by this student's own ticks.
  const [tab, setTab] = useState<'pending' | 'completed'>('pending');
  const [openId, setOpenId] = useState<string | null>(null);
  const all = model.sections.flatMap((g) => g.deadlines);
  const completedCount = all.filter((d) => model.isCompleted(d)).length;
  const pendingCount = all.length - completedCount;
  const groups = model.sections
    .map((g) => ({ ...g, deadlines: g.deadlines.filter((d) => model.isCompleted(d) === (tab === 'completed')) }))
    .filter((g) => g.deadlines.length > 0);
  // Read from the model each render, so a deadline deleted from its sheet closes the sheet.
  const open = openId ? all.find((d) => d.id === openId) ?? null : null;
  const [editing, setEditing] = useState(false);

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + Space.s, borderBottomColor: theme.separator }]}>
      <Txt type="headline" accessibilityRole="header">Deadlines</Txt>
      {model.isEmpty ? null : (
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
      <View ref={addButton} collapsable={false} style={styles.add}>
        <IconButton icon="add" label="Add a deadline" disabled={moduleOptions.length === 0} onPress={() => setAdding(true)} />
      </View>
      <DeadlineForm
        visible={adding}
        modules={moduleOptions}
        defaultModule={model.moduleFilter}
        onClose={() => setAdding(false)}
        onSubmit={(fields, details, placement) => {
          if (placement) void model.add(fields, placement, details);
        }}
      />
      <DropdownMenu
        visible={filterOpen}
        anchor={filterButton}
        align="center"
        onClose={() => setFilterOpen(false)}
        actions={[
          { label: 'All modules', selected: model.moduleFilter === null, onPress: () => model.showModule(null) },
          ...moduleChoices.map(({ key, name }) => ({
            label: name, selected: model.moduleFilter === key, onPress: () => model.showModule(key),
          })),
        ]}
      />
    </View>
  );

  if (model.isEmpty && model.isLoading) {
    return (
      <View style={[styles.fill, { backgroundColor: theme.canvas }]}>
        {header}
        <View style={styles.fill}>
          <LoadingScreen caption="Loading deadlines…" slowCaption="Still waiting on the server…" />
        </View>
      </View>
    );
  }
  // Said, not shown as "Nothing due": an empty list that is really a failed load reads as
  // "no deadlines", which is how a broken fetch went unnoticed.
  if (model.isEmpty && model.errorText) {
    return (
      <View style={[styles.fill, { backgroundColor: theme.canvas }]}>
        {header}
        <EmptyState
          icon="offline"
          title="Couldn't load deadlines"
          message={model.errorText}
          action={<InlineAction title="Try again" onPress={() => void model.reload()} />}
        />
      </View>
    );
  }
  if (model.isEmpty) {
    return (
      <View style={[styles.fill, { backgroundColor: theme.canvas }]}>
        {header}
        <EmptyState
          icon="running"
          title="Nothing due"
          message={
            modules.length === 0
              ? 'Once your timetable loads, deadlines your classmates share will appear here.'
              : 'Nobody has shared an assignment, quiz or exam for your modules yet. Tap + to add the first one.'
          }
        />
      </View>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: theme.canvas }]}>
      {header}
      <View style={styles.tabs} accessibilityRole="tablist">
        {(['pending', 'completed'] as const).map((key) => {
          const on = tab === key;
          const count = key === 'pending' ? pendingCount : completedCount;
          return (
            <Pressable
              key={key}
              onPress={() => setTab(key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${key === 'pending' ? 'Pending' : 'Completed'}, ${count}`}
              style={[styles.tabPill, on ? { backgroundColor: theme.accent } : { backgroundColor: theme.surface }]}
            >
              <Txt type="subheadline" color={on ? theme.onAccent : theme.ink} style={on ? styles.tabOn : undefined}>
                {key === 'pending' ? 'Pending' : 'Completed'}
              </Txt>
              <Txt type="caption" color={on ? theme.onAccent : theme.inkSecondary} style={styles.tabCount}>{count}</Txt>
            </Pressable>
          );
        })}
      </View>
      <ListScroll
        refreshing={model.isLoading}
        onRefresh={() => void model.reload()}
        contentStyle={{ paddingBottom: clearance }}
      >
        {model.errorText ? (
          <Section>
            <Row><Label icon="warning" text={model.errorText} type="caption" color={theme.inkSecondary} /></Row>
          </Section>
        ) : null}
        <CardSwap swapKey={`${model.moduleFilter ?? 'all'}-${tab}`}>
          <View style={styles.list}>
            {groups.length === 0 ? (
              <View style={styles.none}>
                <Txt type="title3">{tab === 'pending' ? 'All caught up' : 'Nothing completed yet'}</Txt>
                <Txt type="subheadline" color={theme.inkSecondary}>
                  {tab === 'pending' ? 'Nothing left to hand in.' : 'Tick off a deadline with its circle and it moves here.'}
                </Txt>
              </View>
            ) : null}
            {groups.map((group) => (
              <View key={group.section}>
                <View style={styles.sectionHeader}>
                  <Txt type="footnote" color={theme.inkSecondary} accessibilityRole="header" style={styles.sectionTitle}>
                    {deadlineSectionTitle(group.section).toUpperCase()}
                    {group.section === 'thisWeek' && showsThisWeek ? `  (${week.weekLabel})` : ''}
                  </Txt>
                </View>
                {group.deadlines.map((d) => (
                  <DeadlineCard
                    key={d.id}
                    deadline={d}
                    moduleName={week.moduleName(d.moduleKey)}
                    completed={model.isCompleted(d)}
                    onToggle={() => model.toggleCompleted(d)}
                    onOpen={() => setOpenId(d.id)}
                  />
                ))}
              </View>
            ))}
          </View>
        </CardSwap>
      </ListScroll>

      {/* The card, opened: every setting the deadline has, for a student, for its poster and for an admin. */}
      <Sheet
        visible={open !== null}
        title="Deadline"
        onClose={() => setOpenId(null)}
        left={open && canEdit(model.moderation, model.isMine(open)) ? <BarButton title="Edit" onPress={() => setEditing(true)} /> : undefined}
        right={<BarButton title="Done" bold onPress={() => setOpenId(null)} />}
      >
        <ListScroll>
          {open ? (
            <View style={styles.sheetBody}>
              <DeadlineRow
                deadline={open}
                moduleName={week.moduleName(open.moduleKey)}
                standing={model.standing(open)}
                isMine={model.isMine(open)}
                variant="schedule"
                actions={{
                  onConfirm: () => void model.toggleConfirmation(open),
                  onDispute: () => void model.toggleDispute(open),
                  onEdit: (fields, details) => void model.edit(open, fields, details),
                  onRename: (label) => void model.rename(open, label),
                  onDelete: () => void model.remove(open),
                  onReport: (reason) => void model.report(open, reason),
                  onHideAuthor: () => void model.hideAuthor(open),
                  onSaveDetails: (text) => void model.details.save(open, text),
                  onReportDetails: () => void model.details.report(open),
                  onVerify: () => void model.toggleVerified(open),
                  onToggleCompleted: () => model.toggleCompleted(open),
                }}
                detailsProblem={model.details.problem(open)}
                detailsReported={model.details.reported.has(open.id)}
                moderation={model.moderation}
                completed={model.isCompleted(open)}
              />
            </View>
          ) : null}
        </ListScroll>
        {open && canEdit(model.moderation, model.isMine(open)) ? (
          <DeadlineForm
            visible={editing}
            editing={{ deadline: open, standing: model.standing(open) }}
            confirms={model.moderation.canVerify}
            onClose={() => setEditing(false)}
            onSubmit={(fields, details) => void model.edit(open, fields, details)}
          />
        ) : null}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { alignItems: 'center', justifyContent: 'center', minHeight: 44, paddingBottom: Space.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  filter: { maxWidth: '80%' },
  // Level with the title, as ⋯ is on the timetable.
  add: { position: 'absolute', right: Space.s, bottom: 0 },
  // Pills as the weekday pills of the design this is after: a white capsule, the selected one filled.
  tabs: { flexDirection: 'row', gap: Space.s, paddingHorizontal: Space.l, paddingTop: Space.m },
  tabPill: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space.xs, minHeight: 40, borderRadius: 999 },
  tabOn: { fontWeight: '600' },
  tabCount: { fontWeight: '600', fontVariant: ['tabular-nums'] },
  list: { paddingHorizontal: Space.l, paddingTop: Space.m },
  sectionHeader: { paddingVertical: Space.s },
  sectionTitle: { fontWeight: '600', letterSpacing: 0.4 },
  none: { paddingVertical: Space.xl, gap: Space.xs },
  sheetBody: { padding: Space.l },
  filterLabel: { flexDirection: 'row', alignItems: 'center', gap: Space.xxs },
  shrink: { flexShrink: 1 },
});
