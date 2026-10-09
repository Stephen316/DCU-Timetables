import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ClassHighlight, Deadline, deadlineKindLabel, displayTitle, highlightReason } from '../../core/deadline';
import { locationDisplay, parsedLocations } from '../../core/roomLocation';
import { WeekGrid as Placement, PlacedEvent } from '../../core/schedule';
import { addDays, formatTime, formatWeekdayDayMonth, isSameDay, isWeekend, startOfDay, startOfWeek, weekdayShort } from '../../core/time';
import { compactTitleOf, isOnline, TimetableEvent, titleOf } from '../../core/timetableEvent';
import { DeadlineMark, Hatch, Icon, Txt } from '../../ui/components';
import { MacShell } from '../../data/macShell';
import { highlightIcon, highlightTint } from '../../ui/meaning';
import { moduleTint, Radius, Space, useTheme, withAlpha } from '../../ui/theme';
import { DayEvents } from './WeekModel';
import { usePagerDrag } from './Pager';
import { EditKind } from './editing';

const HOUR_HEIGHT = 58;
const GUTTER = 40;
const NOW_DOT = 7;
/** One line of `caption2` text in a block, and the block's padding and border above and below it. */
const LINE_HEIGHT = 13.5;
const BLOCK_INSET = 8;
/** The Mac app's margin down each side of the grid: a window is wider than the week needs. */
const MAC_SIDE = Space.xl;

/**
 * A week laid out as a timetable grid: days across, hours down, classes as blocks.
 * Overlapping classes share the column width.
 */
export function WeekGridView({
  eventsByDay, ghostsByDay, editing, weekStart, clashingIDs, highlight, dueAt, onSelect, onEdit, now,
}: {
  eventsByDay: DayEvents[];
  /** The course's classes that aren't the student's, shown while editing. */
  ghostsByDay: DayEvents[];
  /** Edit timetable is on: a tap adds a ghost or removes a class instead of opening it. */
  editing: boolean;
  weekStart: Date | null;
  clashingIDs: Set<string>;
  highlight: (event: TimetableEvent) => ClassHighlight | null;
  dueAt: (event: TimetableEvent) => Deadline[];
  onSelect: (event: TimetableEvent) => void;
  onEdit: (event: TimetableEvent, kind: EditKind) => void;
  now: Date;
}) {
  const theme = useTheme();
  const pagerDrag = usePagerDrag();
  const [onMac] = React.useState(() => MacShell.isPresent());
  const shownDays = editing ? [...eventsByDay, ...ghostsByDay] : eventsByDay;
  const all = shownDays.flatMap((d) => d.events);
  const ghostIDs = new Set(editing ? ghostsByDay.flatMap((d) => d.events.map((e) => e.id)) : []);

  // Mon–Fri, plus a weekend day only when something is scheduled on it.
  const anchor = shownDays[0]?.day ?? weekStart;
  const days: Date[] = anchor
    ? Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i))
        .filter((d) => !isWeekend(d) || shownDays.some((e) => isSameDay(e.day, d)))
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
    <View style={[styles.fill, { backgroundColor: theme.canvas }, onMac && styles.macSides]}>
      <GridBody
        days={days}
        hours={hours}
        gridHeight={gridHeight}
        now={now}
        renderColumn={(day, width) => {
          const placed = Placement.place(shownDays.filter((d) => isSameDay(d.day, day)).flatMap((d) => d.events));
          return placed.map((item) => {
            const edit: EditKind | undefined = !editing ? undefined : ghostIDs.has(item.event.id) ? 'add' : 'remove';
            return (
              <Block
                key={`${edit ?? ''}${item.event.id}`}
                item={item}
                dayWidth={width}
                top={offsetY(item.event.start)}
                highlight={edit === 'add' ? null : highlight(item.event)}
                due={edit === 'add' ? [] : dueAt(item.event)}
                isClashing={!editing && clashingIDs.has(item.event.id)}
                edit={edit}
                onPress={() => {
                  if (pagerDrag.isSuppressingTaps()) return;
                  if (edit) onEdit(item.event, edit);
                  else onSelect(item.event);
                }}
              />
            );
          });
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
      <ScrollView contentContainerStyle={styles.gridScroll} showsVerticalScrollIndicator={false}>
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
          {width > 0 ? <NowLine days={days} hours={hours} dayWidth={dayWidth} now={now} /> : null}
        </View>
      </ScrollView>
    </View>
  );
}

/**
 * Where the day has got to, as Calendar marks it: the time in red in the hours column, a red
 * line with a dot across today, and a faint one across the rest of the week. It moves as the
 * clock ticks, and shows only while today is on the grid and inside its hours.
 */
function NowLine({ days, hours, dayWidth, now }: { days: Date[]; hours: number[]; dayWidth: number; now: Date }) {
  const theme = useTheme();
  const today = days.findIndex((d) => isSameDay(d, now));
  const minutes = (now.getHours() - hours[0]) * 60 + now.getMinutes();
  if (today < 0 || hours.length === 0 || minutes < 0 || minutes > hours.length * 60) return null;
  const top = (minutes / 60) * HOUR_HEIGHT;
  const todayLeft = GUTTER + today * dayWidth;
  return (
    <View pointerEvents="none" style={[styles.now, { top }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.nowAcross, { left: GUTTER, width: days.length * dayWidth, backgroundColor: withAlpha(theme.now, 0.35) }]} />
      <View style={[styles.nowToday, { left: todayLeft, width: dayWidth, backgroundColor: theme.now }]} />
      <View style={[styles.nowDot, { left: todayLeft - NOW_DOT / 2, backgroundColor: theme.now }]} />
      {/* On the canvas, so it covers the hour label it lands on. */}
      <Txt type="caption2" color={theme.now} style={[styles.nowTime, { backgroundColor: theme.canvas }]} maxFontSizeMultiplier={1.2}>
        {formatTime(now)}
      </Txt>
    </View>
  );
}

function Block({
  item, dayWidth, top, highlight, due, isClashing, edit, onPress,
}: {
  item: PlacedEvent;
  dayWidth: number;
  top: number;
  highlight: ClassHighlight | null;
  due: Deadline[];
  isClashing: boolean;
  /** Set while editing: what a tap does to the student's timetable. */
  edit?: EditKind;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { event } = item;
  const ghost = edit === 'add';
  const width = dayWidth / item.columnCount;
  const height = Math.max(26, (event.end.getTime() - event.start.getTime()) / 3_600_000 * HOUR_HEIGHT);
  const tint = moduleTint(theme, event.activity.moduleCode ?? titleOf(event));
  // A highlight outranks a clash outline: not running, or a deadline today, matters more
  // than an overlap the student has already seen.
  const border = highlight ? highlightTint(highlight, theme) : isClashing ? withAlpha(theme.tint.off, 0.55) : 'transparent';
  const first = parsedLocations(event)[0];
  const room = first ? first.buildingName ?? first.code : null;
  // The title wraps into whatever height the class has; the room takes the last line only
  // when that still leaves the title two.
  const lines = Math.max(1, Math.floor((height - BLOCK_INSET) / LINE_HEIGHT));
  const showsRoom = room !== null && lines >= 3;
  const titleLines = showsRoom ? lines - 1 : lines;
  const spoken = [
    ghost ? 'Not in your timetable' : null,
    highlight ? highlightReason(highlight) : null,
    ...due.map((d) => `Due at this class, ${deadlineKindLabel(d.kind)}: ${displayTitle(d)}`),
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
      accessibilityHint={edit === 'add' ? 'Adds it to your timetable' : edit === 'remove' ? 'Removes it from your timetable' : undefined}
      style={({ pressed }) => [
        styles.block,
        {
          left: item.column * width + 1,
          top: top + 1,
          width: Math.max(width - 2, 10),
          height: height - 2,
          // A ghost is only an outline: there, but not yet the student's.
          backgroundColor: withAlpha(tint, ghost ? 0.05 : 0.18),
          borderColor: ghost ? withAlpha(tint, 0.7) : border,
          borderWidth: highlight ? 2 : 1.5,
          borderStyle: ghost ? 'dashed' : 'solid',
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      {isOnline(event) ? <Hatch color={withAlpha(theme.tint.online, 0.28)} spacing={7} origin={{ x: item.column * width + 1, y: top + 1 }} /> : null}
      {ghost ? null : <View style={[styles.bar, { backgroundColor: tint }]} />}
      <View style={[styles.blockText, ghost && styles.faded]}>
        <Txt type="caption2" numberOfLines={titleLines} adjustsFontSizeToFit minimumFontScale={0.8} style={styles.bold} maxFontSizeMultiplier={1.4}>
          {compactTitleOf(event)}
        </Txt>
        {showsRoom ? (
          <Txt type="caption2" numberOfLines={1} color={theme.inkSecondary} maxFontSizeMultiplier={1.4}>{room}</Txt>
        ) : null}
      </View>
      {edit ? (
        <View style={[styles.editMark, { backgroundColor: theme.canvas }]}>
          <Icon name={edit} size={14} color={edit === 'add' ? theme.accent : theme.tint.off} />
        </View>
      ) : null}
      {/* The "!" wins the corner: the border already says a class is off, but only this says something's due. */}
      {due.length > 0 ? (
        <View style={styles.corner}>
          <DeadlineMark size={12} />
        </View>
      ) : highlight ? (
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
  macSides: { paddingHorizontal: MAC_SIDE },
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
  faded: { opacity: 0.5 },
  // Bottom right, clear of the title: the end of the room is the least a block would lose.
  editMark: { position: 'absolute', bottom: 1, right: 1, borderRadius: 7 },
  now: { position: 'absolute', left: 0, right: 0, height: 0 },
  nowAcross: { position: 'absolute', top: -StyleSheet.hairlineWidth / 2, height: StyleSheet.hairlineWidth },
  nowToday: { position: 'absolute', top: -1, height: 2 },
  nowDot: { position: 'absolute', top: -NOW_DOT / 2, width: NOW_DOT, height: NOW_DOT, borderRadius: NOW_DOT / 2 },
  nowTime: { position: 'absolute', left: 0, width: GUTTER - 2, top: -7, textAlign: 'right', paddingRight: 2, fontWeight: '600' },
});
