import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ClassHighlight, highlightReason } from '../../core/deadline';
import { locationDisplay, parsedLocations } from '../../core/roomLocation';
import { WeekGrid as Placement, PlacedEvent } from '../../core/schedule';
import { addDays, formatTime, formatWeekdayDayMonth, isSameDay, isWeekend, startOfDay, startOfWeek, weekdayShort } from '../../core/time';
import { TimetableEvent, titleOf } from '../../core/timetableEvent';
import { Icon, Txt } from '../../ui/components';
import { highlightIcon, highlightTint } from '../../ui/meaning';
import { moduleTint, Radius, Space, useTheme, withAlpha } from '../../ui/theme';
import { DayEvents } from './WeekModel';
import { usePagerDrag } from './Pager';

const HOUR_HEIGHT = 58;
const GUTTER = 40;

/**
 * A week laid out as a timetable grid: days across, hours down, classes as blocks.
 * Overlapping classes share the column width.
 */
export function WeekGridView({
  eventsByDay, weekStart, clashingIDs, highlight, onSelect, now,
}: {
  eventsByDay: DayEvents[];
  weekStart: Date | null;
  clashingIDs: Set<string>;
  highlight: (event: TimetableEvent) => ClassHighlight | null;
  onSelect: (event: TimetableEvent) => void;
  now: Date;
}) {
  const theme = useTheme();
  const pagerDrag = usePagerDrag();
  const all = eventsByDay.flatMap((d) => d.events);

  // Mon–Fri, plus a weekend day only when something is scheduled on it.
  const anchor = eventsByDay[0]?.day ?? weekStart;
  const days: Date[] = anchor
    ? Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i))
        .filter((d) => !isWeekend(d) || eventsByDay.some((e) => isSameDay(e.day, d)))
    : [];

  const hours = (() => {
    if (all.length === 0) return range(9, 18);
    const low = Math.min(...all.map((e) => e.start.getHours()));
    const high = Math.max(...all.map((e) => (e.end.getMinutes() > 0 ? e.end.getHours() + 1 : e.end.getHours())), low + 1);
    return range(low, high);
  })();
  const gridHeight = hours.length * HOUR_HEIGHT;

  const offsetY = (date: Date) => ((date.getHours() - hours[0]) * 60 + date.getMinutes()) / 60 * HOUR_HEIGHT;

  return (
    <View style={[styles.fill, { backgroundColor: theme.canvas }]}>
      <GridBody
        days={days}
        hours={hours}
        gridHeight={gridHeight}
        now={now}
        renderColumn={(day, width) => {
          const placed = Placement.place(eventsByDay.find((d) => isSameDay(d.day, day))?.events ?? []);
          return placed.map((item) => (
            <Block
              key={item.event.id}
              item={item}
              dayWidth={width}
              top={offsetY(item.event.start)}
              highlight={highlight(item.event)}
              isClashing={clashingIDs.has(item.event.id)}
              onPress={() => !pagerDrag.isSuppressingTaps() && onSelect(item.event)}
            />
          ));
        }}
      />
    </View>
  );
}

function GridBody({
  days, hours, gridHeight, now, renderColumn,
}: {
  days: Date[];
  hours: number[];
  gridHeight: number;
  now: Date;
  renderColumn: (day: Date, width: number) => React.ReactNode;
}) {
  const theme = useTheme();
  const [width, setWidth] = React.useState(0);
  const columns = Math.max(days.length, 1);
  const dayWidth = Math.max(58, (width - GUTTER - 8) / columns);
  return (
    <View style={styles.fill} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <View style={[styles.header, { borderBottomColor: theme.separator }]}>
        <View style={{ width: GUTTER }} />
        {days.map((day) => {
          const today = isSameDay(day, now);
          return (
            <View key={day.getTime()} style={[styles.dayHead, { width: dayWidth }]} accessible accessibilityRole="header"
              accessibilityLabel={formatWeekdayDayMonth(day)} accessibilityState={{ selected: today }}>
              <Txt type="caption2" color={theme.inkSecondary}>{weekdayShort(day)}</Txt>
              <Txt type="footnote" color={today ? theme.accent : theme.ink} style={today ? styles.bold : undefined}>{day.getDate()}</Txt>
            </View>
          );
        })}
      </View>
      <ScrollView contentContainerStyle={styles.gridScroll}>
        <View style={styles.gridRow}>
          <View style={{ width: GUTTER, height: gridHeight }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            {hours.map((hour) => (
              <Txt key={hour} type="caption2" color={theme.inkSecondary} style={[styles.hourLabel, { height: HOUR_HEIGHT }]}>
                {hourLabel(hour)}
              </Txt>
            ))}
          </View>
          {width > 0
            ? days.map((day) => (
                <View key={day.getTime()} style={[styles.column, { width: dayWidth, height: gridHeight, borderLeftColor: theme.separator }]}>
                  {hours.map((hour) => (
                    <View key={hour} pointerEvents="none" style={[styles.hourLine, { top: (hour - hours[0]) * HOUR_HEIGHT, backgroundColor: theme.separator }]} />
                  ))}
                  {renderColumn(startOfDay(day), dayWidth)}
                </View>
              ))
            : null}
        </View>
      </ScrollView>
    </View>
  );
}

function Block({
  item, dayWidth, top, highlight, isClashing, onPress,
}: {
  item: PlacedEvent;
  dayWidth: number;
  top: number;
  highlight: ClassHighlight | null;
  isClashing: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { event } = item;
  const width = dayWidth / item.columnCount;
  const height = Math.max(26, (event.end.getTime() - event.start.getTime()) / 3_600_000 * HOUR_HEIGHT);
  const tint = moduleTint(theme, event.activity.moduleCode ?? titleOf(event));
  // A highlight outranks a clash outline: not running, or a deadline today, matters more
  // than an overlap the student has already seen.
  const border = highlight ? highlightTint(highlight, theme) : isClashing ? withAlpha(theme.tint.off, 0.55) : 'transparent';
  const first = parsedLocations(event)[0];
  const room = first ? first.buildingName ?? first.code : null;
  const spoken = [
    highlight ? highlightReason(highlight) : null,
    titleOf(event),
    `${formatTime(event.start)} to ${formatTime(event.end)}`,
    locationDisplay(event),
    isClashing ? 'Overlaps another class' : null,
  ].filter(Boolean).join(', ');

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      style={({ pressed }) => [
        styles.block,
        {
          left: item.column * width + 1,
          top: top + 1,
          width: Math.max(width - 2, 10),
          height: height - 2,
          backgroundColor: withAlpha(tint, 0.18),
          borderColor: border,
          borderWidth: highlight ? 2 : 1.5,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View style={[styles.bar, { backgroundColor: tint }]} />
      <View style={styles.blockText}>
        <Txt type="caption2" numberOfLines={1} style={styles.bold} maxFontSizeMultiplier={1.4}>{event.activity.moduleCode ?? titleOf(event)}</Txt>
        {height > 44 && room ? (
          <Txt type="caption2" numberOfLines={1} color={theme.inkSecondary} maxFontSizeMultiplier={1.4}>{room}</Txt>
        ) : null}
      </View>
      {highlight ? (
        <View style={styles.corner}>
          <Icon name={highlightIcon(highlight)} size={11} color={highlightTint(highlight, theme)} />
        </View>
      ) : null}
    </Pressable>
  );
}

function range(low: number, high: number): number[] {
  return Array.from({ length: high - low + 1 }, (_, i) => low + i);
}

function hourLabel(hour: number): string {
  const suffix = hour < 12 ? 'am' : 'pm';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}${suffix}`;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  dayHead: { alignItems: 'center', gap: 1 },
  bold: { fontWeight: '700' },
  gridScroll: { paddingTop: Space.s, paddingBottom: 64 },
  gridRow: { flexDirection: 'row' },
  hourLabel: { textAlign: 'right', paddingRight: Space.xs, marginTop: -6 },
  column: { borderLeftWidth: StyleSheet.hairlineWidth },
  hourLine: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth },
  block: { position: 'absolute', borderRadius: Radius.block, overflow: 'hidden', flexDirection: 'row' },
  bar: { width: 2.5 },
  blockText: { flex: 1, paddingHorizontal: 3, paddingVertical: 2 },
  corner: { position: 'absolute', top: 1, right: 1 },
});
