import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { deadlineSectionTitle } from '../../core/deadline';
import { startOfWeek } from '../../core/time';
import { useModel, useNow, useServices } from '../../state/hooks';
import { useWeekModel } from '../../state/root';
import { EmptyState, Icon, InlineAction, Label, ListScroll, Row, Section, Spinner, Txt } from '../../ui/components';
import { DropdownMenu } from '../../ui/DropdownMenu';
import { CardInset, Radius, Space, useTheme } from '../../ui/theme';
import { DeadlineRow } from './DeadlineRows';
import { DeadlinesModel } from './DeadlinesModel';
import { useTutorial } from '../tutorial/Tutorial';

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
      void model.load(modules);
    }, [model, modules]),
  );
  // The tutorial has the student open this tab.
  const tutorial = useTutorial();
  useFocusEffect(useCallback(() => tutorial?.signal('deadlinesShown'), [tutorial]));

  const filterButton = useRef<View>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const moduleChoices = model.modulesWithDeadlines
    .map((key) => ({ key, name: week.moduleName(key) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const filterTitle = model.moduleFilter ? week.moduleName(model.moduleFilter) : 'All modules';
  // The timetable's week may have been moved on; its label is only this week's when it hasn't.
  const now = useNow();
  const showsThisWeek = !!week.weekLabel && week.weekStart?.getTime() === startOfWeek(now).getTime();

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
        <Spinner />
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
              : 'Nobody has shared an assignment, quiz or exam for your modules yet. Open a class and add the first one.'
          }
        />
      </View>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: theme.canvas }]}>
      {header}
      <ListScroll
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
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.separator }]}>
          {model.sections.map((group, i) => (
            <View
              key={group.section}
              style={[styles.sectionBox, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.separator }]}
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
                <DeadlineRow
                  key={d.id}
                  deadline={d}
                  moduleName={week.moduleName(d.moduleKey)}
                  standing={model.standing(d)}
                  isMine={model.isMine(d)}
                  variant="schedule"
                  showDate={group.section !== 'today' && group.section !== 'tomorrow'}
                  actions={{
                    onConfirm: () => void model.toggleConfirmation(d),
                    onDispute: () => void model.toggleDispute(d),
                    onEdit: (fields) => void model.edit(d, fields),
                    onRename: (label) => void model.rename(d, label),
                    onDelete: () => void model.remove(d),
                    onReport: (reason) => void model.report(d, reason),
                    onHideAuthor: () => void model.hideAuthor(d),
                  }}
                />
              ))}
            </View>
          ))}
        </View>
      </ListScroll>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { alignItems: 'center', justifyContent: 'center', minHeight: 44, paddingBottom: Space.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  filter: { maxWidth: '80%' },
  card: { marginHorizontal: Space.l, marginTop: Space.l, borderRadius: Radius.card, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  sectionBox: { paddingHorizontal: CardInset.x, paddingVertical: CardInset.y, gap: Space.s },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.s },
  sectionTitle: { flexDirection: 'row', alignItems: 'baseline', gap: Space.xs, flexShrink: 1 },
  count: { fontWeight: '600', fontVariant: ['tabular-nums'] },
  filterLabel: { flexDirection: 'row', alignItems: 'center', gap: Space.xxs },
  shrink: { flexShrink: 1 },
  summary: { flexDirection: 'row', justifyContent: 'center', gap: Space.l, paddingVertical: Space.s, borderTopWidth: StyleSheet.hairlineWidth },
});
