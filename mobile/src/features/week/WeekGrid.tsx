import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ClassHighlight, Deadline, deadlineKindLabel, displayTitle, highlightReason } from '../../core/deadline';
import { locationDisplay, parsedLocations } from '../../core/roomLocation';
import { WeekGrid as Placement, PlacedEvent } from '../../core/schedule';
import { addDays, formatTime, formatWeekdayDayMonth, isSameDay, isWeekend, startOfDay, startOfWeek, weekdayShort } from '../../core/time';
import { compactTitleOf, isOnline, TimetableEvent, titleOf } from '../../core/timetableEvent';
import { DeadlineMark, Hatch, Icon, Txt, useWide } from '../../ui/components';
import { MacShell } from '../../data/macShell';
import { highlightIcon, highlightTint } from '../../ui/meaning';
import { concentric, moduleTint, Radius, Space, useTheme, withAlpha } from '../../ui/theme';
import { DayEvents } from './WeekModel';
import { usePagerDrag } from './Pager';
import { EditKind } from './editing';
import { useTutorialTarget } from '../tutorial/Tutorial';

interface GridScale {
  hourHeight: number;
  gutter: number;
  nowDot: number;
  /** One line of text in a block, and the block's padding and border above and below it. */
  lineHeight: number;
  blockInset: number;
  desktop: boolean;
}

const PHONE_SCALE: GridScale = {
  hourHeight: 58,
  gutter: 40,
  nowDot: 7,
  lineHeight: 13.5,
  blockInset: 8,
  desktop: false,
};

const DESKTOP_SCALE: GridScale = {
  hourHeight: 88,
  gutter: 64,
  nowDot: 9,
  lineHeight: 20,
  blockInset: 12,
  desktop: true,
};

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
  const [inMacApp] = React.useState(() => MacShell.isPresent());
  const wide = useWide();
  const onDesktop = inMacApp || wide;
  const scale = onDesktop ? DESKTOP_SCALE : PHONE_SCALE;
  const shownDays = editing ? [...eventsByDay, ...ghostsByDay] : eventsByDay;
  const ghostIDs = new Set(editing ? ghostsByDay.flatMap((d) => d.events.map((e) => e.id)) : []);
  // The tutorial has the student open the week's first class from here; a desktop window's also
  // points at the grid itself, which is all its timetable is.
  const gridTarget = useTutorialTarget('weekGrid', onDesktop);
  const firstID = eventsByDay.flatMap((d) => d.events).reduce<TimetableEvent | null>((a, e) => (!a || e.start < a.start ? e : a), null)?.id ?? null;

  // Mon–Fri, plus a weekend day only when something is scheduled on it.
  const anchor = shownDays[0]?.day ?? weekStart;
  const days: Date[] = anchor
    ? Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i))
        .filter((d) => !isWeekend(d) || shownDays.some((e) => isSameDay(e.day, d)))
    : [];

  const all = shownDays.flatMap((d) => d.events);
  const hours = (() => {
    if (!onDesktop) {
      // Phone: as before, just the hours the week's classes span.
      if (all.length === 0) return range(9, 18);
      const low = Math.min(...all.map((e) => e.start.getHours()));
      const high = Math.max(...all.map((e) => (e.end.getMinutes() > 0 ? e.end.getHours() + 1 : e.end.getHours())), low + 1);
      return range(low, high);
    }
    // Desktop: 8am–10pm, widened only if a class falls outside it.
    const low = all.length === 0 ? 8 : Math.min(8, ...all.map((e) => e.start.getHours()));
    const high = all.length === 0
      ? 22
      : Math.max(22, ...all.map((e) => (e.end.getMinutes() > 0 ? e.end.getHours() + 1 : e.end.getHours())), low + 1);
    return range(low, high);
  })();
  const gridHeight = hours.length * scale.hourHeight;

  const offsetY = (date: Date) => ((date.getHours() - hours[0]) * 60 + date.getMinutes()) / 60 * scale.hourHeight;

  return (
    <View style={[styles.fill, { backgroundColor: theme.canvas }, onDesktop && styles.desktopOuter]}>
      <View
        ref={gridTarget}
        collapsable={false}
        style={[
          styles.fill,
          onDesktop && [styles.desktopFrame, { borderColor: theme.separator, backgroundColor: theme.canvas }],
        ]}
      >
        <GridBody
          days={days}
          hours={hours}
          gridHeight={gridHeight}
          scale={scale}
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
                  scale={scale}
                  highlight={edit === 'add' ? null : highlight(item.event)}
                  due={edit === 'add' ? [] : dueAt(item.event)}
                  isClashing={!editing && clashingIDs.has(item.event.id)}
                  edit={edit}
                  isFirst={!editing && item.event.id === firstID}
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
    </View>
  );
}

function GridBody({
  days, hours, gridHeight, scale, now, renderColumn,
}: {
  days: Date[];
  hours: number[];
  gridHeight: number;
  scale: GridScale;
  now: Date;
  renderColumn: (day: Date, width: number) => React.ReactNode;
}) {
  const theme = useTheme();
  const [width, setWidth] = React.useState(0);
  const columns = Math.max(days.length, 1);
  const rightPad = scale.desktop ? 0 : 8;
  const dayWidth = Math.max(58, (width - scale.gutter - rightPad) / columns);
  const lineThickness = scale.desktop ? 1 : StyleSheet.hairlineWidth;

  return (
    <View style={styles.fill} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <View
        style={[
          styles.header,
          scale.desktop && styles.headerDesktop,
          {
            borderBottomWidth: lineThickness,
            borderBottomColor: theme.separator,
            backgroundColor: scale.desktop ? theme.surface : theme.canvas,
          },
        ]}
      >
        <View style={{ width: scale.gutter }} />
        {days.map((day) => {
          const today = isSameDay(day, now);
          return (
            <View
              key={day.getTime()}
              style={[
                styles.dayHead,
                scale.desktop && [styles.dayHeadDesktop, { borderLeftWidth: lineThickness, borderLeftColor: theme.separator }],
                { width: dayWidth },
              ]}
              accessible
              accessibilityRole="header"
              accessibilityLabel={formatWeekdayDayMonth(day)}
              accessibilityState={{ selected: today }}
            >
              <Txt type={scale.desktop ? 'subheadline' : 'caption2'} color={today ? theme.accent : theme.inkSecondary} style={scale.desktop ? styles.semibold : undefined}>
                {weekdayShort(day)}
              </Txt>
              <Txt type={scale.desktop ? 'title3' : 'footnote'} color={today ? theme.accent : theme.ink} style={today ? styles.bold : undefined}>
                {day.getDate()}
              </Txt>
            </View>
          );
        })}
      </View>
      <ScrollView contentContainerStyle={[styles.gridScroll, scale.desktop && styles.gridScrollDesktop]} showsVerticalScrollIndicator={false}>
        <View style={[styles.gridRow, scale.desktop && { borderBottomWidth: lineThickness, borderBottomColor: theme.separator }]}>
          <View
            style={[
              { width: scale.gutter, height: gridHeight },
              scale.desktop && { backgroundColor: withAlpha(theme.surface, 0.5) },
            ]}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
          >
            {hours.map((hour) => (
              <View key={hour} style={{ position: 'absolute', left: 0, right: 0, top: (hour - hours[0]) * scale.hourHeight }}>
                {scale.desktop ? (
                  <View style={{ position: 'absolute', right: 0, top: 0, width: 6, height: lineThickness, backgroundColor: theme.separator }} />
                ) : null}
                <Txt
                  type={scale.desktop ? 'subheadline' : 'caption2'}
                  color={theme.inkSecondary}
                  style={[
                    styles.hourLabel,
                    scale.desktop && styles.hourLabelDesktop,
                    { top: scale.desktop ? 4 : -6 },
                  ]}
                >
                  {hourLabel(hour)}
                </Txt>
              </View>
            ))}
          </View>
          {width > 0
            ? days.map((day) => (
                <View
                  key={day.getTime()}
                  style={{
                    width: dayWidth,
                    height: gridHeight,
                    borderLeftWidth: lineThickness,
                    borderLeftColor: theme.separator,
                  }}
                >
                  {hours.map((hour) => (
                    <View
                      key={hour}
                      pointerEvents="none"
                      style={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        top: (hour - hours[0]) * scale.hourHeight,
                        height: lineThickness,
                        backgroundColor: theme.separator,
                      }}
                    />
                  ))}
                  {renderColumn(startOfDay(day), dayWidth)}
                </View>
              ))
            : null}
          {width > 0 ? <NowLine days={days} hours={hours} dayWidth={dayWidth} scale={scale} now={now} /> : null}
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
function NowLine({ days, hours, dayWidth, scale, now }: { days: Date[]; hours: number[]; dayWidth: number; scale: GridScale; now: Date }) {
  const theme = useTheme();
  const today = days.findIndex((d) => isSameDay(d, now));
  const minutes = (now.getHours() - hours[0]) * 60 + now.getMinutes();
  if (today < 0 || hours.length === 0 || minutes < 0 || minutes > hours.length * 60) return null;
  const top = (minutes / 60) * scale.hourHeight;
  const todayLeft = scale.gutter + today * dayWidth;
  return (
    <View pointerEvents="none" style={[styles.now, { top }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.nowAcross, { left: scale.gutter, width: days.length * dayWidth, backgroundColor: withAlpha(theme.now, 0.35) }]} />
      <View style={[styles.nowToday, { left: todayLeft, width: dayWidth, backgroundColor: theme.now }]} />
      <View style={{
        position: 'absolute',
        left: todayLeft - scale.nowDot / 2,
        top: -scale.nowDot / 2,
        width: scale.nowDot,
        height: scale.nowDot,
        borderRadius: scale.nowDot / 2,
        backgroundColor: theme.now,
      }} />
      {/* On the canvas, so it covers the hour label it lands on. */}
      <Txt
        type={scale.desktop ? 'footnote' : 'caption2'}
        color={theme.now}
        style={[
          styles.nowTime,
          { width: scale.gutter - (scale.desktop ? 8 : 2), top: scale.desktop ? -9 : -7, backgroundColor: theme.canvas },
        ]}
        maxFontSizeMultiplier={1.2}
      >
        {formatTime(now)}
      </Txt>
    </View>
  );
}

function Block({
  item, dayWidth, top, scale, highlight, due, isClashing, edit, isFirst = false, onPress,
}: {
  item: PlacedEvent;
  dayWidth: number;
  top: number;
  scale: GridScale;
  highlight: ClassHighlight | null;
  due: Deadline[];
  isClashing: boolean;
  /** Set while editing: what a tap does to the student's timetable. */
  edit?: EditKind;
  /** The week's first class, which the tutorial has the student open. */
  isFirst?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const tutorialTarget = useTutorialTarget('firstClass', isFirst);
  const { event } = item;
  const ghost = edit === 'add';
  // Settled as not running: greyed out, its module colour gone, so it reads as not there.
  const cancelled = highlight?.kind === 'cancelled';
  const width = dayWidth / item.columnCount;
  const height = Math.max(scale.desktop ? 36 : 26, (event.end.getTime() - event.start.getTime()) / 3_600_000 * scale.hourHeight);
  const tint = cancelled ? theme.inkTertiary : moduleTint(theme, event.activity.moduleCode ?? titleOf(event));
  // A highlight outranks a clash outline: not running, or a deadline today, matters more
  // than an overlap the student has already seen. On desktop, every block gets a subtle module
  // border so adjacent hours and columns stay crisply delineated.
  const defaultBorder = scale.desktop ? withAlpha(tint, 0.45) : 'transparent';
  const border = cancelled
    ? withAlpha(theme.inkTertiary, 0.5)
    : highlight
      ? highlightTint(highlight, theme)
      : isClashing
        ? withAlpha(theme.tint.off, 0.55)
        : defaultBorder;
  const first = parsedLocations(event)[0];
  const room = first ? first.buildingName ?? first.code : null;
  // The title wraps into whatever height the class has; the room takes the last line only
  // when that still leaves the title two.
  const lines = Math.max(1, Math.floor((height - scale.blockInset) / scale.lineHeight));
  const showsRoom = room !== null && lines >= 3;
  const titleLines = showsRoom ? lines - 1 : lines;
  const blockRadius = scale.desktop ? Radius.control : Radius.block;
  const inset = scale.desktop ? 2 : 1;
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
      ref={tutorialTarget}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint={edit === 'add' ? 'Adds it to your timetable' : edit === 'remove' ? 'Removes it from your timetable' : undefined}
      style={({ pressed }) => [
        styles.block,
        {
          left: item.column * width + inset,
          top: top + inset,
          width: Math.max(width - inset * 2, 10),
          height: height - inset * 2,
          borderRadius: blockRadius,
          // A ghost is only an outline: there, but not yet the student's.
          backgroundColor: withAlpha(tint, ghost ? 0.05 : cancelled ? 0.1 : 0.18),
          borderColor: ghost ? withAlpha(tint, 0.7) : border,
          borderWidth: highlight && !cancelled ? 2 : scale.desktop ? 1 : 1.5,
          borderStyle: ghost ? 'dashed' : 'solid',
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      {isOnline(event) ? <Hatch color={withAlpha(theme.tint.online, 0.28)} spacing={7} origin={{ x: item.column * width + inset, y: top + inset }} /> : null}
      {ghost ? null : <View style={[styles.bar, scale.desktop && styles.barDesktop, { backgroundColor: tint }]} />}
      <View style={[styles.blockText, scale.desktop && styles.blockTextDesktop, (ghost || cancelled) && styles.faded]}>
        <Txt type={scale.desktop ? 'callout' : 'caption2'} numberOfLines={titleLines} adjustsFontSizeToFit minimumFontScale={0.8} style={styles.bold} maxFontSizeMultiplier={1.4}>
          {compactTitleOf(event)}
        </Txt>
        {showsRoom ? (
          <Txt type={scale.desktop ? 'subheadline' : 'caption2'} numberOfLines={1} color={theme.inkSecondary} maxFontSizeMultiplier={1.4}>{room}</Txt>
        ) : null}
      </View>
      {edit ? (
        <View
          style={[
            styles.editMark,
            {
              backgroundColor: theme.canvas,
              borderRadius: scale.desktop ? 9 : 7,
              borderBottomRightRadius: concentric(blockRadius, 1),
            },
          ]}
        >
          <Icon name={edit} size={scale.desktop ? 18 : 14} color={edit === 'add' ? theme.accent : theme.tint.off} />
        </View>
      ) : null}
      {/* The "!" wins the corner: the border already says a class is off or greyed out, but only this says something's due. */}
      {due.length > 0 ? (
        <View style={[styles.corner, scale.desktop && styles.cornerDesktop]}>
          <DeadlineMark size={scale.desktop ? 16 : 12} />
        </View>
      ) : highlight ? (
        <View style={[styles.corner, scale.desktop && styles.cornerDesktop]}>
          <Icon name={highlightIcon(highlight)} size={scale.desktop ? 15 : 11} color={highlightTint(highlight, theme)} />
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
  desktopOuter: { padding: Space.l },
  desktopFrame: { borderWidth: 1, borderRadius: Radius.card, overflow: 'hidden' },
  header: { flexDirection: 'row', paddingVertical: 6 },
  headerDesktop: { paddingVertical: 0 },
  dayHead: { alignItems: 'center', gap: 1 },
  dayHeadDesktop: { paddingVertical: 10, gap: 2 },
  bold: { fontWeight: '700' },
  semibold: { fontWeight: '600' },
  gridScroll: { paddingTop: Space.s, paddingBottom: 64 },
  gridScrollDesktop: { paddingTop: 0, paddingBottom: Space.xl },
  gridRow: { flexDirection: 'row' },
  // Placed like the hour lines, centred on its own line on phone, or tucked below the hour line on desktop.
  hourLabel: { position: 'absolute', left: 0, right: 0, textAlign: 'right', paddingRight: Space.xs },
  hourLabelDesktop: { paddingRight: Space.s },
  block: { position: 'absolute', overflow: 'hidden', flexDirection: 'row' },
  bar: { width: 2.5 },
  barDesktop: { width: 4 },
  blockText: { flex: 1, paddingHorizontal: 3, paddingVertical: 2 },
  blockTextDesktop: { paddingHorizontal: 8, paddingVertical: 5, gap: 2 },
  corner: { position: 'absolute', top: 1, right: 1 },
  cornerDesktop: { top: 4, right: 4 },
  faded: { opacity: 0.5 },
  // Bottom right, clear of the title: the end of the room is the least a block would lose.
  // Round, but for the corner it shares with the block: that one curves round the block's own
  // corner centre, a point in from its edge.
  editMark: { position: 'absolute', bottom: 1, right: 1 },
  now: { position: 'absolute', left: 0, right: 0, height: 0 },
  nowAcross: { position: 'absolute', top: -StyleSheet.hairlineWidth / 2, height: StyleSheet.hairlineWidth },
  nowToday: { position: 'absolute', top: -1, height: 2 },
  nowTime: { position: 'absolute', left: 0, textAlign: 'right', paddingRight: 2, fontWeight: '600' },
});
