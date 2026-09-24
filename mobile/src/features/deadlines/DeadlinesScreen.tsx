import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { deadlineSectionTitle } from '../../core/deadline';
import { useModel, useServices } from '../../state/hooks';
import { useWeekModel } from '../../state/root';
import { EmptyState, Label, ListScroll, Row, Section, Spinner, Txt } from '../../ui/components';
import { Space, useTheme } from '../../ui/theme';
import { DeadlineRow } from './DeadlineRows';
import { DeadlinesModel } from './DeadlinesModel';

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

  useEffect(() => {
    void model.load(modules);
  }, [model, modules]);

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + Space.s, borderBottomColor: theme.separator }]}>
      <Txt type="headline" accessibilityRole="header">Deadlines</Txt>
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
        {model.sections.map((group) => (
          <Section key={group.section} header={deadlineSectionTitle(group.section)}>
            {group.deadlines.map((d) => (
              <DeadlineRow
                key={d.id}
                deadline={d}
                standing={model.standing(d)}
                isMine={model.isMine(d)}
                variant="schedule"
                actions={{
                  onConfirm: () => void model.toggleConfirmation(d),
                  onDelete: () => void model.remove(d),
                  onReport: (reason) => void model.report(d, reason),
                  onHideAuthor: () => void model.hideAuthor(d),
                }}
              />
            ))}
          </Section>
        ))}
      </ListScroll>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { alignItems: 'center', justifyContent: 'center', minHeight: 44, paddingBottom: Space.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  summary: { flexDirection: 'row', justifyContent: 'center', gap: Space.l, paddingVertical: Space.s, borderTopWidth: StyleSheet.hairlineWidth },
});
