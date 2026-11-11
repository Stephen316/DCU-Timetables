import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';
import { deadlineSectionTitle, DeadlineRules, PAST_DEADLINE_DAYS } from '../../core/deadline';
import { startOfWeek } from '../../core/time';
import { useModel, useNow, useServices } from '../../state/hooks';
import { useWeekModel } from '../../state/root';
import { EmptyState, Icon, InlineAction, Label, ListScroll, PillButton, Row, ScreenHeader, Section, Txt } from '../../ui/components';
import { LoadingScreen } from '../../ui/LoadingScreen';
import { DropdownMenu } from '../../ui/DropdownMenu';
import { useTabBarClearance } from '../../ui/floatingBar';
import { CardSwap } from '../../ui/CardSwap';
import { elevation, Space, useTheme, withAlpha } from '../../ui/theme';
import { DeadlineCard } from './DeadlineCard';
import { DeadlineForm, DeadlineSheet } from './DeadlineRows';
import { DeadlinesModel } from './DeadlinesModel';
import { useTutorial, useTutorialTarget } from '../tutorial/Tutorial';

/**
 * Every assignment, quiz and exam the student's modules have, soonest first. The timetable
 * answers "where am I at 11?"; this answers "what's coming?".
 */
export function DeadlinesScreen() {
  const theme = useTheme();
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

  // Pending and Completed are one list split by this student's own ticks. Completed also ends
  // with Past: everything whose day is over, ticked or not, for the fortnight the server keeps it.
  const [tab, setTab] = useState<'pending' | 'completed'>('pending');
  const [openId, setOpenId] = useState<string | null>(null);
  const all = model.sections.flatMap((g) => g.deadlines);
  const ticked = all.filter((d) => model.isCompleted(d)).length;
  const pendingCount = all.length - ticked;
  const completedCount = ticked + model.past.length;
  const groups = model.sections
    .map((g) => ({ ...g, deadlines: g.deadlines.filter((d) => model.isCompleted(d) === (tab === 'completed')) }))
    .filter((g) => g.deadlines.length > 0);
  const past = tab === 'completed' ? model.past : [];
  // Read from the model each render, so a deadline deleted from its sheet closes the sheet.
  const open = openId ? [...all, ...model.past].find((d) => d.id === openId) ?? null : null;

  const header = (
    <>
      <ScreenHeader
        title="Deadlines"
        subtitle={model.isEmpty ? undefined : (
          <View ref={filterButton} collapsable={false} style={styles.filter}>
            <Pressable
              onPress={() => setFilterOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={`Showing ${filterTitle}`}
              accessibilityHint="Choose a module"
              hitSlop={10}
              style={({ pressed }) => [styles.filterLabel, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Txt type="footnote" color={theme.accent} numberOfLines={1} style={[styles.shrink, styles.semibold]}>{filterTitle}</Txt>
              <Icon name="dropdown" size={14} color={theme.accent} />
            </Pressable>
          </View>
        )}
        right={
          <View ref={addButton} collapsable={false}>
            <PillButton icon="plus" filled label="Add a deadline" disabled={moduleOptions.length === 0} onPress={() => setAdding(true)} />
          </View>
        }
      />
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
    </>
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
              style={[
                styles.tabPill,
                on
                  ? { backgroundColor: theme.accent, boxShadow: `0 0 0 4px ${withAlpha(theme.accent, 0.16)}` }
                  : [{ backgroundColor: theme.surface }, elevation(theme)],
              ]}
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
            {groups.length === 0 && past.length === 0 ? (
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
                    {deadlineSectionTitle(group.section)}
                    {group.section === 'thisWeek' && showsThisWeek ? ` · ${week.weekLabel}` : ''}
                  </Txt>
                </View>
                {group.deadlines.map((d) => (
                  <DeadlineCard
                    key={d.id}
                    deadline={d}
                    moduleName={week.moduleName(d.moduleKey)}
                    completed={model.isCompleted(d)}
                    disputed={model.standing(d).disputeCount > 0}
                    onToggle={() => model.toggleCompleted(d)}
                    onOpen={() => setOpenId(d.id)}
                  />
                ))}
              </View>
            ))}
            {past.length > 0 ? (
              <View>
                <View style={styles.sectionHeader}>
                  <Txt type="footnote" color={theme.inkSecondary} accessibilityRole="header" style={styles.sectionTitle}>
                    {`Past · last ${PAST_DEADLINE_DAYS} days`}
                  </Txt>
                </View>
                {/* Its day is over, so ticking one only changes its circle: it stays in Past. */}
                {past.map((d) => (
                  <DeadlineCard
                    key={d.id}
                    deadline={d}
                    moduleName={week.moduleName(d.moduleKey)}
                    completed={model.isCompleted(d)}
                    disputed={model.standing(d).disputeCount > 0}
                    onToggle={() => model.toggleCompleted(d)}
                    onOpen={() => setOpenId(d.id)}
                    leaves={false}
                  />
                ))}
              </View>
            ) : null}
          </View>
        </CardSwap>
      </ListScroll>

      {/* The card, opened: every setting the deadline has, for a student, its poster and an admin. */}
      <DeadlineSheet
        deadline={open}
        moduleName={open ? week.moduleName(open.moduleKey) : ''}
        standing={open ? model.standing(open) : null}
        isMine={open ? model.isMine(open) : false}
        moderation={model.moderation}
        completed={open ? model.isCompleted(open) : false}
        detailsProblem={open ? model.details.problem(open) : null}
        detailsReported={open ? model.details.reported.has(open.id) : false}
        onClose={() => setOpenId(null)}
        actions={{
          onConfirm: () => open && void model.toggleConfirmation(open),
          onDispute: () => open && void model.toggleDispute(open),
          onEdit: (fields, details) => open && void model.edit(open, fields, details),
          onRename: (label) => open && void model.rename(open, label),
          onDelete: () => open && void model.remove(open),
          onReport: (reason) => open && void model.report(open, reason),
          onHideAuthor: () => open && void model.hideAuthor(open),
          onSaveDetails: (text) => open && void model.details.save(open, text),
          onReportDetails: () => open && void model.details.report(open),
          onVerify: () => open && void model.toggleVerified(open),
          onToggleCompleted: () => open && model.toggleCompleted(open),
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  filter: { maxWidth: '100%' },
  // Pills as the weekday pills of the design this is after: white capsules, the chosen one violet.
  tabs: { flexDirection: 'row', gap: Space.m, paddingHorizontal: Space.l, paddingTop: Space.xs, paddingBottom: Space.xs },
  tabPill: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space.xs, minHeight: 44, borderRadius: 999 },
  tabOn: { fontWeight: '600' },
  tabCount: { fontWeight: '600', fontVariant: ['tabular-nums'] },
  list: { paddingHorizontal: Space.l, paddingTop: Space.xs },
  sectionHeader: { paddingTop: Space.m, paddingBottom: Space.s, paddingHorizontal: Space.xs },
  sectionTitle: { fontWeight: '600' },
  none: { paddingVertical: Space.xl, gap: Space.xs, alignItems: 'center' },
  filterLabel: { flexDirection: 'row', alignItems: 'center', gap: Space.xxs },
  shrink: { flexShrink: 1 },
  semibold: { fontWeight: '600' },
});
