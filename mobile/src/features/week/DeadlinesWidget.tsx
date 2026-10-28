import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { deadlineCountdown, displayTitle, gradeWeightLabel } from '../../core/deadline';
import { WeekdayIndex } from '../../core/misc';
import {
  addDays, formatDayMonth, formatTime, formatWeekdayDayMonthTime, isSameDay,
  isToday, isTomorrow, startOfDay, startOfWeek, weekdayName,
} from '../../core/time';
import { PrefKey } from '../../data/storage';
import { useModel, useNow, usePrefJSON } from '../../state/hooks';
import { useWeekModel } from '../../state/root';
import {
  BarButton, EmptyState, Icon, IconButton, Label, ListScroll, PrimaryButton, Row, Section, Sheet, Txt,
} from '../../ui/components';
import { deadlineKindIcon, deadlineTint } from '../../ui/meaning';
import { Radius, Space, useTheme } from '../../ui/theme';
import { buildJournalEntries, JournalDeadlineEntry, StoredJournalItem } from '../journal/journalData';
import { DayPage } from './DayPage';

/**
 * The left-hand widget column on the desktop Timetable screen:
 * 1. **Deadlines** card (Today, Tomorrow, and clickable This Week pop-out Sheet window)
 * 2. **Today** card separated underneath it — clicking it opens a pop-out Sheet window
 *    with the mobile single-day view (`DayPage`) and `< Today >` day navigation integrated inside it.
 */
export function DeadlinesWidget() {
  const theme = useTheme();
  const now = useNow();
  const week = useModel(useWeekModel());
  const [storedItems] = usePrefJSON<StoredJournalItem[]>(PrefKey.journalEntries, []);
  const [thisWeekOpen, setThisWeekOpen] = useState(false);
  const [todayOpen, setTodayOpen] = useState(false);

  const allEntries = useMemo(
    () => buildJournalEntries(week.deadlines, storedItems),
    [week.deadlines, storedItems],
  );

  const todayEntries = useMemo(
    () => allEntries.filter((e) => isToday(e.deadline.due, now)),
    [allEntries, now],
  );

  const tomorrowEntries = useMemo(
    () => allEntries.filter((e) => isTomorrow(e.deadline.due, now)),
    [allEntries, now],
  );

  const weekWindow = useMemo(() => {
    const start = startOfDay(week.weekStart ?? startOfWeek(now));
    const end = addDays(start, 7);
    return { start, end };
  }, [week.weekStart, now]);

  const thisWeekEntries = useMemo(
    () =>
      allEntries.filter((e) => {
        const t = e.deadline.due.getTime();
        return t >= weekWindow.start.getTime() && t < weekWindow.end.getTime();
      }),
    [allEntries, weekWindow],
  );

  const moduleNameOf = (key: string) => (key === 'Personal' ? 'Personal' : week.moduleName(key));

  const activeDayDate = useMemo(() => {
    const first = week.weeks[week.weekIndex]?.firstDay ?? week.weekStart ?? startOfWeek(now);
    return addDays(startOfDay(first), week.dayIndex);
  }, [week.weeks, week.weekIndex, week.weekStart, week.dayIndex, now]);

  const activeDayEvents = useMemo(() => {
    const byDay = week.eventsByDayForWeekIndex(week.weekIndex);
    return byDay.find((d) => isSameDay(d.day, activeDayDate))?.events ?? [];
  }, [week, activeDayDate]);

  const stepDay = (delta: number) => {
    const totalDays = Math.max(week.weeks.length * WeekdayIndex.daysPerWeek, WeekdayIndex.daysPerWeek);
    const flat = WeekdayIndex.flat(week.weekIndex, week.dayIndex);
    const nextFlat = Math.min(Math.max(flat + delta, 0), totalDays - 1);
    const { week: nextWeek, day: nextDay } = WeekdayIndex.split(nextFlat);
    week.setDay(nextWeek, nextDay);
  };

  return (
    <ScrollView
      style={styles.railScroll}
      contentContainerStyle={styles.railContent}
      showsVerticalScrollIndicator={false}
    >
      {/* CARD 1: Deadlines (Today, Tomorrow, This Week) */}
      <View style={styles.group}>
        <View style={styles.groupHeader}>
          <Txt type="footnote" color={theme.inkSecondary} style={styles.semibold}>DEADLINES</Txt>
          <Pressable
            onPress={() => router.push('/journal')}
            accessibilityRole="button"
            accessibilityLabel="Manage deadlines in Journal"
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <Txt type="footnote" color={theme.accent} style={styles.semibold}>Journal</Txt>
          </Pressable>
        </View>

        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.separator }]}>
          {/* Section 1: Today */}
          <View style={[styles.sectionBox, { borderBottomColor: theme.separator }]}>
            <View style={styles.sectionHeaderRow}>
              <Txt type="subheadline" style={styles.semibold}>Today</Txt>
              <Txt type="caption" color={todayEntries.length > 0 ? theme.tint.due : theme.inkSecondary} style={styles.semibold}>
                {todayEntries.length === 0 ? 'None' : String(todayEntries.length)}
              </Txt>
            </View>
            {todayEntries.length > 0 ? (
              <View style={styles.compactList}>
                {todayEntries.map((entry) => (
                  <CompactDeadlineItem
                    key={entry.deadline.id}
                    entry={entry}
                    moduleName={moduleNameOf(entry.deadline.moduleKey)}
                    timeText={formatTime(entry.deadline.due)}
                  />
                ))}
              </View>
            ) : null}
          </View>

          {/* Section 2: Tomorrow */}
          <View style={[styles.sectionBox, { borderBottomColor: theme.separator }]}>
            <View style={styles.sectionHeaderRow}>
              <Txt type="subheadline" style={styles.semibold}>Tomorrow</Txt>
              <Txt type="caption" color={tomorrowEntries.length > 0 ? theme.accent : theme.inkSecondary} style={styles.semibold}>
                {tomorrowEntries.length === 0 ? 'None' : String(tomorrowEntries.length)}
              </Txt>
            </View>
            {tomorrowEntries.length > 0 ? (
              <View style={styles.compactList}>
                {tomorrowEntries.map((entry) => (
                  <CompactDeadlineItem
                    key={entry.deadline.id}
                    entry={entry}
                    moduleName={moduleNameOf(entry.deadline.moduleKey)}
                    timeText={formatTime(entry.deadline.due)}
                  />
                ))}
              </View>
            ) : null}
          </View>

          {/* Section 3: This Week (clickable pop-out window) */}
          <Pressable
            onPress={() => setThisWeekOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`This week's deadlines (${week.weekLabel || 'This Week'}), click to open window`}
            style={({ pressed }) => [
              styles.sectionBox,
              styles.thisWeekBox,
              { backgroundColor: pressed ? theme.raised : 'transparent' },
            ]}
          >
            <View style={styles.sectionHeaderRow}>
              <View style={styles.thisWeekTitleRow}>
                <Txt type="subheadline" style={styles.semibold}>This Week</Txt>
                {week.weekLabel ? (
                  <Txt type="caption" color={theme.inkSecondary}>({week.weekLabel})</Txt>
                ) : null}
              </View>
              <View style={styles.thisWeekRight}>
                <Txt type="caption" color={thisWeekEntries.length > 0 ? theme.accent : theme.inkSecondary} style={styles.semibold}>
                  {thisWeekEntries.length === 0 ? 'None' : String(thisWeekEntries.length)}
                </Txt>
                <Icon name="forward" size={15} color={theme.inkTertiary} />
              </View>
            </View>
          </Pressable>
        </View>
      </View>

      {/* CARD 2 (Under Deadlines, clearly separated): Today — opens the Today pop-out window */}
      <View style={styles.group}>
        <View style={styles.groupHeader}>
          <Txt type="footnote" color={theme.inkSecondary} style={styles.semibold}>SCHEDULE</Txt>
        </View>
        <Pressable
          onPress={() => setTodayOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Open Today window"
          style={({ pressed }) => [
            styles.card,
            styles.todayCard,
            {
              backgroundColor: pressed ? theme.raised : theme.surface,
              borderColor: theme.separator,
            },
          ]}
        >
          <View style={styles.todayCardText}>
            <Txt type="headline" style={styles.semibold}>Today</Txt>
            <Txt type="caption" color={theme.inkSecondary}>
              {weekdayName(activeDayDate)}, {formatDayMonth(activeDayDate)} · {activeDayEvents.length}{' '}
              {activeDayEvents.length === 1 ? 'class' : 'classes'}
            </Txt>
          </View>
          <Icon name="forward" size={18} color={theme.inkTertiary} />
        </Pressable>
      </View>

      {/* Pop-out Window 1: This Week's Deadlines */}
      <Sheet
        visible={thisWeekOpen}
        title={week.weekLabel ? `Deadlines · ${week.weekLabel}` : "This Week's Deadlines"}
        onClose={() => setThisWeekOpen(false)}
        left={<IconButton icon="arrowLeft" label="Back" onPress={() => setThisWeekOpen(false)} />}
        right={
          <BarButton
            title="Journal"
            bold
            onPress={() => {
              setThisWeekOpen(false);
              router.push('/journal');
            }}
          />
        }
      >
        {thisWeekEntries.length === 0 ? (
          <EmptyState
            icon="clock"
            title={`No deadlines in ${week.weekLabel || 'this week'}`}
            message="Deadlines from your modules and tasks you add in Journal for this week will appear here."
            action={
              <PrimaryButton
                title="Add in Journal"
                onPress={() => {
                  setThisWeekOpen(false);
                  router.push('/journal');
                }}
              />
            }
          />
        ) : (
          <ListScroll>
            <Section
              header={`${thisWeekEntries.length} assigned for ${week.weekLabel || 'this week'}`}
              footer="Exported from your Journal. Add or edit tasks in the Journal tab."
            >
              {thisWeekEntries.map((entry) => {
                const { deadline, typeLabel, isManual } = entry;
                const tint = deadlineTint(deadline.kind, theme);
                const moduleName = moduleNameOf(deadline.moduleKey);
                const worth = gradeWeightLabel(deadline.gradeWeight);
                return (
                  <Row key={deadline.id}>
                    <View style={styles.modalRow}>
                      <View style={styles.modalRowTop}>
                        <Icon name={deadlineKindIcon(deadline.kind)} size={20} color={tint} />
                        <View style={styles.modalRowText}>
                          <Txt type="headline">{displayTitle(deadline)}</Txt>
                          <Txt type="subheadline" color={theme.inkSecondary}>
                            {moduleName} · {typeLabel} · {worth}
                          </Txt>
                          <Txt type="caption" color={theme.inkSecondary}>
                            {formatWeekdayDayMonthTime(deadline.due)}
                          </Txt>
                        </View>
                        <View style={styles.modalRowRight}>
                          <Txt type="caption" color={theme.accent} style={styles.semibold}>
                            {deadlineCountdown(deadline.due, now)}
                          </Txt>
                          {isManual ? (
                            <Label icon="edit" text="Journal" type="caption2" color={theme.inkSecondary} />
                          ) : null}
                        </View>
                      </View>
                    </View>
                  </Row>
                );
              })}
            </Section>
          </ListScroll>
        )}
      </Sheet>

      {/* Pop-out Window 2: Today (with < Today > navigation integrated inside the window) */}
      <Sheet
        visible={todayOpen}
        title="Today"
        onClose={() => setTodayOpen(false)}
        left={<IconButton icon="arrowLeft" label="Back" onPress={() => setTodayOpen(false)} />}
        right={
          <View style={styles.dayControls}>
            <IconButton icon="back" size={20} label="Previous day" onPress={() => stepDay(-1)} />
            <BarButton title="Today" onPress={() => week.showCurrentWeek()} />
            <IconButton icon="forward" size={20} label="Next day" onPress={() => stepDay(1)} />
          </View>
        }
      >
        <DayPage
          day={activeDayDate}
          events={activeDayEvents}
          ghosts={[]}
          editing={false}
          now={now}
          clashingIDs={week.clashingIDs}
          highlight={(e) => week.highlight(e)}
          dueAt={(e) => week.dueAt(e)}
          isLoading={week.isLoading}
          onSelect={(e) => {
            setTodayOpen(false);
            router.push({ pathname: '/class/[id]', params: { id: e.id } });
          }}
          onEdit={() => undefined}
        />
      </Sheet>
    </ScrollView>
  );
}

function CompactDeadlineItem({
  entry,
  moduleName,
  timeText,
}: {
  entry: JournalDeadlineEntry;
  moduleName: string;
  timeText: string;
}) {
  const theme = useTheme();
  const tint = deadlineTint(entry.deadline.kind, theme);
  return (
    <View style={[styles.compactItem, { backgroundColor: theme.canvas, borderColor: theme.separator }]}>
      <View style={[styles.compactAccentBar, { backgroundColor: tint }]} />
      <View style={styles.compactBody}>
        <View style={styles.compactTopRow}>
          <Txt type="footnote" numberOfLines={1} style={[styles.semibold, styles.compactTitle]}>
            {displayTitle(entry.deadline)}
          </Txt>
          <Txt type="caption2" color={theme.inkSecondary} style={styles.tabular}>
            {timeText}
          </Txt>
        </View>
        <Txt type="caption2" color={theme.inkSecondary} numberOfLines={1}>
          {moduleName} · {entry.typeLabel}
        </Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  railScroll: { flex: 1 },
  railContent: {
    padding: Space.l,
    gap: Space.xl,
  },
  group: {
    gap: Space.xs,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space.xs,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.card,
    overflow: 'hidden',
  },
  sectionBox: {
    paddingHorizontal: Space.m,
    paddingVertical: Space.m,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Space.xs,
  },
  thisWeekBox: {
    borderBottomWidth: 0,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 24,
  },
  thisWeekTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
  },
  thisWeekRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
  },
  compactList: {
    gap: Space.xs,
    marginTop: 2,
  },
  compactItem: {
    flexDirection: 'row',
    borderRadius: Radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  compactAccentBar: {
    width: 3,
  },
  compactBody: {
    flex: 1,
    paddingHorizontal: Space.s,
    paddingVertical: 5,
    gap: 2,
  },
  compactTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.xs,
  },
  compactTitle: {
    flex: 1,
  },
  todayCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space.m,
    paddingVertical: Space.m,
  },
  todayCardText: {
    flex: 1,
    gap: 2,
  },
  dayControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  modalRow: {
    paddingVertical: 2,
  },
  modalRowTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.m,
  },
  modalRowText: {
    flex: 1,
    gap: 2,
  },
  modalRowRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  semibold: { fontWeight: '600' },
  tabular: { fontVariant: ['tabular-nums'] },
});
