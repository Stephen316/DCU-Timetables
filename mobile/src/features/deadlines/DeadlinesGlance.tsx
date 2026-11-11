import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { DeadlineSchedule, DeadlineSection, deadlineSectionTitle, displayTitle } from '../../core/deadline';
import { useModel, useNow, useServices } from '../../state/hooks';
import { useWeekModel } from '../../state/root';
import { Icon, Txt } from '../../ui/components';
import { deadlineKindIcon, deadlineTint } from '../../ui/meaning';
import { elevation, moduleTint, Radius, Space, useTheme } from '../../ui/theme';
import { dueLabel } from './DeadlineCard';
import { CompletedDeadlines } from './Completed';

/** Today and tomorrow always show; the rest of the coming week only while the list stays short. */
const MAX_ROWS = 6;
const SOON: DeadlineSection[] = ['today', 'tomorrow'];
const LATER: DeadlineSection[] = ['thisWeek', 'nextWeek'];

/**
 * The deadlines tab, small: what's due today and tomorrow, and the week after that when there
 * isn't too much of it. Sits beside the day on a wide screen; a tap goes to the full list.
 */
export function DeadlinesGlance() {
  const theme = useTheme();
  const now = useNow();
  const services = useServices();
  const week = useModel(useWeekModel());
  const completed = new CompletedDeadlines(services.prefs);
  const open = week.deadlines.filter((d) => !completed.has(d.id));
  const sections = DeadlineSchedule.grouped(open, now);

  const soon = sections.filter((s) => SOON.includes(s.section));
  const later = sections.filter((s) => LATER.includes(s.section));
  const soonCount = soon.reduce((n, s) => n + s.deadlines.length, 0);
  const laterCount = later.reduce((n, s) => n + s.deadlines.length, 0);
  // The coming week joins in whole, or not at all: half a week reads as all of it.
  const shown = soonCount + laterCount <= MAX_ROWS ? [...soon, ...later] : soon;
  const shownCount = shown.reduce((n, s) => n + s.deadlines.length, 0);
  const hidden = soonCount + laterCount - shownCount;

  const goToAll = () => router.navigate('/deadlines');

  return (
    <View style={[styles.card, { backgroundColor: theme.surface }, elevation(theme)]}>
      <Pressable onPress={goToAll} accessibilityRole="button" accessibilityLabel="Open deadlines" style={styles.head}>
        <Txt type="headline" style={styles.bold}>Deadlines</Txt>
        <Icon name="forward" size={14} color={theme.inkTertiary} />
      </Pressable>
      {shownCount === 0 ? (
        <Txt type="footnote" color={theme.inkSecondary}>
          {laterCount > 0 ? `Nothing due today or tomorrow · ${laterCount} later this fortnight` : 'Nothing due in the next two weeks.'}
        </Txt>
      ) : (
        shown.map(({ section, deadlines }) => (
          <View key={section} style={styles.section}>
            <Txt type="caption" color={theme.inkTertiary} style={styles.semibold}>{deadlineSectionTitle(section).toUpperCase()}</Txt>
            {deadlines.map((d) => (
              <Pressable key={d.id} onPress={goToAll} accessibilityRole="button" style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}>
                <View style={[styles.stripe, { backgroundColor: moduleTint(theme, d.moduleKey) }]} />
                <Icon name={deadlineKindIcon(d.kind)} size={13} color={deadlineTint(d.kind, theme)} />
                <View style={styles.text}>
                  <Txt type="footnote" numberOfLines={1} style={styles.semibold}>{displayTitle(d)}</Txt>
                  <Txt type="caption" numberOfLines={1} color={theme.inkSecondary}>{week.moduleName(d.moduleKey)}</Txt>
                </View>
                <Txt type="caption" color={theme.inkSecondary} style={styles.tabular}>{dueLabel(d.due, now)}</Txt>
              </Pressable>
            ))}
          </View>
        ))
      )}
      {hidden > 0 ? (
        <Pressable onPress={goToAll} accessibilityRole="button">
          <Txt type="footnote" color={theme.accent} style={styles.semibold}>
            {hidden === 1 ? '1 more this fortnight' : `${hidden} more this fortnight`}
          </Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Radius.card + Space.xs, padding: Space.l, gap: Space.m },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  section: { gap: Space.s },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.s },
  stripe: { width: 3, alignSelf: 'stretch', borderRadius: 2 },
  text: { flex: 1, minWidth: 0 },
  bold: { fontWeight: '700' },
  semibold: { fontWeight: '600' },
  tabular: { fontVariant: ['tabular-nums'] },
});
