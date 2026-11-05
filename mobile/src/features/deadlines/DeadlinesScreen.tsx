import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { deadlineSectionTitle, DeadlineRules, DeadlineSection } from '../../core/deadline';
import { startOfWeek } from '../../core/time';
import { useModel, useNow, useServices } from '../../state/hooks';
import { useWeekModel } from '../../state/root';
import { EmptyState, Icon, IconButton, InlineAction, Label, ListScroll, Row, Section, Txt, useReduceMotion } from '../../ui/components';
import { LoadingScreen } from '../../ui/LoadingScreen';
import { DropdownMenu } from '../../ui/DropdownMenu';
import { CardInset, Radius, Space, useTheme } from '../../ui/theme';
import { DeadlineForm, DeadlineRow } from './DeadlineRows';
import { DeadlinesModel } from './DeadlinesModel';
import { useTutorial, useTutorialTarget } from '../tutorial/Tutorial';

/**
 * Every assignment, quiz and exam the student's modules have, soonest first. The timetable
 * answers "where am I at 11?"; this answers "what's coming?".
 */
export function DeadlinesScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
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

  // A new deadline is brought into view and ringed for a moment: further down a long list,
  // closing the form would otherwise leave the screen as it was, as if adding had failed.
  // Each layout is relative to its parent, so a row's place in the list is the sum of three.
  const reduceMotion = useReduceMotion();
  const scroll = useRef<ScrollView>(null);
  const viewport = useRef({ offsetY: 0, height: 0 });
  const cardY = useRef(0);
  const sectionY = useRef(new Map<DeadlineSection, number>());
  const rowLayout = useRef(new Map<string, { y: number; height: number }>());
  const toReveal = useRef<string | null>(null);
  // The ring shows round the newest addition until its fade has run once.
  const [ringDone, setRingDone] = useState<string | null>(null);
  const ringed = model.justAdded !== ringDone ? model.justAdded : null;
  const clearRing = useCallback(() => setRingDone(model.justAdded), [model.justAdded]);
  const reveal = () => {
    const id = toReveal.current;
    const group = id ? model.sections.find((g) => g.deadlines.some((d) => d.id === id)) : undefined;
    const row = id ? rowLayout.current.get(id) : undefined;
    const top = group ? sectionY.current.get(group.section) : undefined;
    if (!row || top === undefined) return; // Not laid out yet: the layout that is still to come calls this again.
    toReveal.current = null;
    const y = cardY.current + top + row.y;
    const { offsetY, height } = viewport.current;
    if (y >= offsetY && y + row.height <= offsetY + height) return;
    scroll.current?.scrollTo({ y: Math.max(0, y - Space.l), animated: !reduceMotion });
  };
  useEffect(() => {
    const id = model.justAdded;
    if (!id) return;
    toReveal.current = id;
    const added = model.sections.flatMap((g) => g.deadlines).find((d) => d.id === id);
    if (added) AccessibilityInfo.announceForAccessibility(`Added ${added.title}`);
    reveal();
    // Only a new id is a new arrival; the sections it reads are as they were when it was added.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.justAdded]);

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
      <ListScroll
        scrollRef={scroll}
        onViewport={(offsetY, height) => {
          viewport.current = { offsetY, height };
        }}
        refreshing={model.isLoading}
        onRefresh={() => void model.reload()}
        // The count is the point of the tab, so it stays on screen while the list scrolls.
        footer={
          <View style={[styles.summary, { backgroundColor: theme.surface, borderTopColor: theme.separator }]}>
            <Txt type="caption" color={theme.inkSecondary}>{model.total} upcoming</Txt>
            {model.testCount > 0 ? <Label icon="test" text={`${model.testCount} sat in class`} type="caption" color={theme.tint.test} /> : null}
          </View>
        }
      >
        {model.errorText ? (
          <Section>
            <Row><Label icon="warning" text={model.errorText} type="caption" color={theme.inkSecondary} /></Row>
          </Section>
        ) : null}
        {/* One card, a section each, split by hairlines — the same panel as the desktop rail's. */}
        <View
          style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.separator }]}
          onLayout={(e) => {
            cardY.current = e.nativeEvent.layout.y;
            reveal();
          }}
        >
          {model.sections.map((group, i) => (
            <View
              key={group.section}
              style={[styles.sectionBox, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.separator }]}
              onLayout={(e) => {
                sectionY.current.set(group.section, e.nativeEvent.layout.y);
                reveal();
              }}
            >
              <View style={styles.sectionHeader}>
                <View style={styles.sectionTitle}>
                  <Txt type="headline" accessibilityRole="header">{deadlineSectionTitle(group.section)}</Txt>
                  {group.section === 'thisWeek' && showsThisWeek ? (
                    <Txt type="footnote" color={theme.inkSecondary}>({week.weekLabel})</Txt>
                  ) : null}
                </View>
                <Txt
                  type="subheadline"
                  color={group.section === 'today' ? theme.tint.due : theme.accent}
                  style={styles.count}
                  accessibilityLabel={`${group.deadlines.length} due`}
                >
                  {group.deadlines.length}
                </Txt>
              </View>
              {group.deadlines.map((d) => (
                <View
                  key={d.id}
                  onLayout={(e) => {
                    const { y, height } = e.nativeEvent.layout;
                    rowLayout.current.set(d.id, { y, height });
                    reveal();
                  }}
                >
                <DeadlineRow
                  deadline={d}
                  moduleName={week.moduleName(d.moduleKey)}
                  standing={model.standing(d)}
                  isMine={model.isMine(d)}
                  variant="schedule"
                  showDate={group.section !== 'today' && group.section !== 'tomorrow'}
                  actions={{
                    onConfirm: () => void model.toggleConfirmation(d),
                    onDispute: () => void model.toggleDispute(d),
                    onEdit: (fields, details) => void model.edit(d, fields, details),
                    onRename: (label) => void model.rename(d, label),
                    onDelete: () => void model.remove(d),
                    onReport: (reason) => void model.report(d, reason),
                    onHideAuthor: () => void model.hideAuthor(d),
                    onSaveDetails: (text) => void model.details.save(d, text),
                    onReportDetails: () => void model.details.report(d),
                    onVerify: () => void model.toggleVerified(d),
                    onToggleCompleted: () => model.toggleCompleted(d),
                  }}
                  detailsProblem={model.details.problem(d)}
                  detailsReported={model.details.reported.has(d.id)}
                  moderation={model.moderation}
                  completed={model.isCompleted(d)}
                />
                {ringed === d.id ? <NewRowRing onDone={clearRing} /> : null}
                </View>
              ))}
            </View>
          ))}
        </View>
      </ListScroll>
    </View>
  );
}

/**
 * A ring that lights round a just-added row and fades, once the list has had a moment to
 * scroll it into view. A fade rather than movement, so it stays with Reduce Motion on.
 */
function NewRowRing({ onDone }: { onDone: () => void }) {
  const theme = useTheme();
  const [opacity] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const ring = Animated.sequence([
      Animated.delay(250),
      Animated.timing(opacity, { toValue: 1, duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: false }),
      Animated.delay(1200),
      Animated.timing(opacity, { toValue: 0, duration: 800, easing: Easing.in(Easing.quad), useNativeDriver: false }),
    ]);
    ring.start(({ finished }) => finished && onDone());
    return () => ring.stop();
  }, [opacity, onDone]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.ring, { borderColor: theme.accent, opacity }]}
    />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  ring: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: Radius.control, borderWidth: 2 },
  header: { alignItems: 'center', justifyContent: 'center', minHeight: 44, paddingBottom: Space.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  filter: { maxWidth: '80%' },
  // Level with the title, as ⋯ is on the timetable.
  add: { position: 'absolute', right: Space.s, bottom: 0 },
  card: { marginHorizontal: Space.l, marginTop: Space.l, borderRadius: Radius.card, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  sectionBox: { paddingHorizontal: CardInset.x, paddingVertical: CardInset.y, gap: Space.s },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.s },
  sectionTitle: { flexDirection: 'row', alignItems: 'baseline', gap: Space.xs, flexShrink: 1 },
  count: { fontWeight: '600', fontVariant: ['tabular-nums'] },
  filterLabel: { flexDirection: 'row', alignItems: 'center', gap: Space.xxs },
  shrink: { flexShrink: 1 },
  summary: { flexDirection: 'row', justifyContent: 'center', gap: Space.l, paddingVertical: Space.s, borderTopWidth: StyleSheet.hairlineWidth },
});
