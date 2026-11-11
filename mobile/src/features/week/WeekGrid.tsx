import React, { ReactNode, Ref } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { kindLabel, activitySummary } from '../../core/activityCode';
import { ClassHighlight, Deadline, deadlineKindLabel, displayTitle, highlightReason } from '../../core/deadline';
import { locationDisplay, parsedLocations } from '../../core/roomLocation';
import { GridHours, WeekGrid as Placement, PlacedEvent } from '../../core/schedule';
import { addDays, formatTime, formatWeekdayDayMonth, isSameDay, isWeekend, startOfDay, startOfWeek, weekdayShort } from '../../core/time';
import { compactTitleOf, isOnline, shortTitleOf, staffText, TimetableEvent, titleOf } from '../../core/timetableEvent';
import { DeadlineMark, Hatch, Icon, IconName, Txt } from '../../ui/components';
import { MacShell } from '../../data/macShell';
import { highlightIcon, highlightTint } from '../../ui/meaning';
import { useTabBarClearance, useWeekFirst } from '../../ui/floatingBar';
import { concentric, elevation, moduleTint, Radius, Space, useTheme, withAlpha } from '../../ui/theme';
import { DayEvents } from './WeekModel';
import { usePagerDrag } from './Pager';
import { EditKind } from './editing';
import { useTutorialTarget } from '../tutorial/Tutorial';

/** An hour on the week grid: room for a short title and its room in a fifth of a phone. */
export const WEEK_HOUR = 58;
/** An hour on the day grid, where a class has the width for its type, room and lecturer too. */
export const DAY_HOUR = 76;
const GUTTER = 40;
const NOW_DOT = 7;
/** Between a block and its neighbours, and the hour lines it sits on. */
const BLOCK_GAP = 2;
/** One line of `caption2` text in a week block. */
const WEEK_LINE = 13.5;
/** One line of `footnote` text in a day block. */
const DAY_LINE = 17;
/** The Mac app's margin down each side of the grid: a window is wider than the week needs. */
const MAC_SIDE = Space.xl;

/**
 * A week laid out as a timetable grid: days across, hours down, classes as solid blocks in
 * their module's colour. Overlapping classes share the column width.
 */
export function WeekGridView({
  eventsByDay, ghostsByDay, editing, isLoaded, weekStart, clashingIDs, highlight, dueAt, onSelect, onEdit, now,
}: {
  eventsByDay: DayEvents[];
  /** The course's classes that aren't the student's, shown while editing. */
  ghostsByDay: DayEvents[];
  /** Edit timetable is on: a tap adds a ghost or removes a class instead of opening it. */
  editing: boolean;
  /** The week's classes have arrived, so an empty grid is a free week and says so. */
  isLoaded: boolean;
  weekStart: Date | null;
  clashingIDs: Set<string>;
  highlight: (event: TimetableEvent) => ClassHighlight | null;
  dueAt: (event: TimetableEvent) => Deadline[];
  onSelect: (event: TimetableEvent) => void;
  onEdit: (event: TimetableEvent, kind: EditKind) => void;
  now: Date;
}) {
  const pagerDrag = usePagerDrag();
  // The week as the front page: it has arrows, and the tour points at the grid itself.
  const weekFirst = useWeekFirst();
  // Only what falls between 8am and 9pm: the grid never draws the night.
  const shownDays = (editing ? [...eventsByDay, ...ghostsByDay] : eventsByDay)
    .map((d) => ({ ...d, events: d.events.filter(GridHours.shows) }));
  const all = shownDays.flatMap((d) => d.events);
  const ghostIDs = new Set(editing ? ghostsByDay.flatMap((d) => d.events.map((e) => e.id)) : []);
  // The tutorial has the student open the week's first class from here; the Mac's also
  // points at the grid itself, which is all its timetable is.
  const gridTarget = useTutorialTarget('weekGrid', weekFirst);
  const firstID = eventsByDay.flatMap((d) => d.events).filter(GridHours.shows).reduce<TimetableEvent | null>((a, e) => (!a || e.start < a.start ? e : a), null)?.id ?? null;

  // Mon–Fri, plus a weekend day only when something is scheduled on it.
  const anchor = shownDays[0]?.day ?? weekStart;
  const days: Date[] = anchor
    ? Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i))
        .filter((d) => !isWeekend(d) || shownDays.some((e) => isSameDay(e.day, d)))
    : [];
  const hours = GridHours.of(all);

  return (
    <TimeGrid
      cardRef={gridTarget}
      heads={days}
      columns={days}
      hours={hours}
      hourHeight={WEEK_HOUR}
      now={now}
      empty={isLoaded && all.length === 0 ? {
        title: 'No classes this week',
        message: editing ? 'Your course has nothing on this week.' : weekFirst ? 'Use the arrows for other weeks.' : 'Swipe left or right for other weeks.',
      } : null}
      renderColumn={(day, width) =>
        Placement.place(shownDays.filter((d) => isSameDay(d.day, day)).flatMap((d) => d.events)).map((item) => {
          const edit: EditKind | undefined = !editing ? undefined : ghostIDs.has(item.event.id) ? 'add' : 'remove';
          return (
            <Block
              key={`${edit ?? ''}${item.event.id}`}
              item={item}
              columnWidth={width}
              hours={hours}
              hourHeight={WEEK_HOUR}
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
        })
      }
    />
  );
}

/**
 * The card both timetables are drawn on: the weekday names across the top, an hours column
 * down the left, and a column per day below — five for the week, one for the day. On the day,
 * the weekday names are the week the day is in, the shown one filled violet, and a tap on
 * another goes to it.
 */
export function TimeGrid({
  heads, columns, hours, hourHeight, now, renderColumn, empty, selected, onPick, cardRef, headRef,
}: {
  /** The weekday names across the top. */
  heads: Date[];
  /** The days drawn below them: every one of `heads` on the week, the one shown on the day. */
  columns: Date[];
  hours: number[];
  hourHeight: number;
  now: Date;
  renderColumn: (day: Date, width: number) => ReactNode;
  /** Said over an empty grid, so a free day or week doesn't read as the app having broken. */
  empty: { title: string; message: string } | null;
  /** The day the day view is showing, ringed in the heads. */
  selected?: Date;
  onPick?: (day: Date) => void;
  cardRef?: Ref<View>;
  headRef?: Ref<View>;
}) {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const [onMac] = React.useState(() => MacShell.isPresent());
  const [width, setWidth] = React.useState(0);
  const inner = Math.max(0, width - GUTTER - Space.s);
  const headWidth = Math.max(44, inner / Math.max(heads.length, 1));
  const columnWidth = Math.max(58, inner / Math.max(columns.length, 1));
  const gridHeight = (hours.length - 1) * hourHeight;

  return (
    <View style={[styles.fill, { backgroundColor: theme.canvas }, styles.cardSides, onMac && styles.macSides]}>
      <View ref={cardRef} collapsable={false} style={[styles.card, { backgroundColor: theme.surface }, elevation(theme)]}>
        <View style={styles.fill} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          <View ref={headRef} collapsable={false} style={styles.header}>
            <View style={{ width: GUTTER }} />
            {heads.map((day) => (
              <DayHead key={day.getTime()} day={day} width={headWidth} now={now} selected={selected} onPick={onPick} />
            ))}
          </View>
          {/* Runs from the first hour to the last and no further; pulled past either, it rubber-bands back. */}
          <ScrollView contentContainerStyle={[styles.gridScroll, { paddingBottom: clearance }]} showsVerticalScrollIndicator={false}>
            <View style={styles.gridRow}>
              <View style={{ width: GUTTER, height: gridHeight }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                {hours.map((hour) => (
                  <Txt key={hour} type="caption2" color={theme.inkTertiary} style={[styles.hourLabel, { top: (hour - hours[0]) * hourHeight - 7 }]}>
                    {hourLabel(hour)}
                  </Txt>
                ))}
              </View>
              {width > 0
                ? columns.map((day) => (
                    <View key={day.getTime()} style={{ width: columnWidth, height: gridHeight }}>
                      {hours.map((hour) => (
                        <View key={hour} pointerEvents="none" style={[styles.hourLine, { top: (hour - hours[0]) * hourHeight, backgroundColor: theme.gridLine }]} />
                      ))}
                      {renderColumn(startOfDay(day), columnWidth)}
                    </View>
                  ))
                : null}
              {width > 0 ? <NowLine days={columns} hours={hours} hourHeight={hourHeight} dayWidth={columnWidth} now={now} /> : null}
            </View>
          </ScrollView>
          {empty ? (
            <View pointerEvents="none" style={styles.emptyOver}>
              <View style={[styles.emptyCard, { backgroundColor: theme.surface }]}>
                <Txt type="title3" style={styles.centred}>{empty.title}</Txt>
                <Txt type="subheadline" color={theme.inkSecondary} style={styles.centred}>{empty.message}</Txt>
              </View>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

/**
 * A weekday over its column: the short name, and the date on a disc. Today's disc is filled
 * violet on the week. On the day, the day shown is the filled one and today is ringed.
 */
function DayHead({ day, width, now, selected, onPick }: {
  day: Date;
  width: number;
  now: Date;
  selected?: Date;
  onPick?: (day: Date) => void;
}) {
  const theme = useTheme();
  const today = isSameDay(day, now);
  const filled = selected ? isSameDay(day, selected) : today;
  const ringed = !!selected && today && !filled;
  const content = (
    <>
      <Txt type="caption2" color={filled || ringed ? theme.accent : theme.inkSecondary} style={filled ? styles.semibold : undefined}>{weekdayShort(day)}</Txt>
      <View style={[styles.disc, filled && { backgroundColor: theme.accent }, ringed && { borderWidth: 1.5, borderColor: theme.accent }]}>
        <Txt type="footnote" color={filled ? theme.onAccent : ringed ? theme.accent : theme.ink} style={filled || ringed ? styles.bold : undefined}>
          {day.getDate()}
        </Txt>
      </View>
    </>
  );
  if (!onPick) {
    return (
      <View style={[styles.dayHead, { width }]} accessible accessibilityRole="header"
        accessibilityLabel={formatWeekdayDayMonth(day)} accessibilityState={{ selected: today }}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      onPress={() => onPick(day)}
      accessibilityRole="tab"
      accessibilityLabel={`${formatWeekdayDayMonth(day)}${today ? ', today' : ''}`}
      accessibilityState={{ selected: filled }}
      style={({ pressed }) => [styles.dayHead, { width, opacity: pressed ? 0.6 : 1 }]}
    >
      {content}
    </Pressable>
  );
}

/**
 * Where the day has got to, as Calendar marks it: the time in red in the hours column, a red
 * line with a dot across today, and a faint one across the rest of the week. It moves as the
 * clock ticks, and shows only while today is on the grid and inside its hours.
 */
function NowLine({ days, hours, hourHeight, dayWidth, now }: { days: Date[]; hours: number[]; hourHeight: number; dayWidth: number; now: Date }) {
  const theme = useTheme();
  const today = days.findIndex((d) => isSameDay(d, now));
  const minutes = (now.getHours() - hours[0]) * 60 + now.getMinutes();
  if (today < 0 || hours.length === 0 || minutes < 0 || minutes > (hours.length - 1) * 60) return null;
  const top = (minutes / 60) * hourHeight;
  const todayLeft = GUTTER + today * dayWidth;
  return (
    <View pointerEvents="none" style={[styles.now, { top }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.nowAcross, { left: GUTTER, width: days.length * dayWidth, backgroundColor: withAlpha(theme.now, 0.35) }]} />
      <View style={[styles.nowToday, { left: todayLeft, width: dayWidth, backgroundColor: theme.now }]} />
      <View style={[styles.nowDot, { left: todayLeft - NOW_DOT / 2, backgroundColor: theme.now }]} />
      {/* On the card's own colour, so it covers the hour label it lands on. */}
      <Txt type="caption2" color={theme.now} style={[styles.nowTime, { backgroundColor: theme.surface }]} maxFontSizeMultiplier={1.2}>
        {formatTime(now)}
      </Txt>
    </View>
  );
}

/** A white pill on a block: "Starts in 20 min", "Reported cancelled". */
export interface BlockChip {
  text: string;
  color: string;
  icon?: IconName;
}

/**
 * One class on a grid: a solid block of its module's colour with white type, as a coloured-in
 * paper timetable. A state is a white badge in its corner rather than an outline, which reads
 * on every module colour where a coloured line fought with them. On the week a block has room
 * for its name, type and room; on the day (`detail`) it also has its times, lecturer, what's
 * due at it and a chip saying when it starts.
 */
export function Block({
  item, columnWidth, hours, hourHeight, highlight, due, isClashing, edit, isFirst = false, detail, onPress,
}: {
  item: PlacedEvent;
  columnWidth: number;
  hours: number[];
  hourHeight: number;
  highlight: ClassHighlight | null;
  due: Deadline[];
  isClashing: boolean;
  /** Set while editing: what a tap does to the student's timetable. */
  edit?: EditKind;
  /** The week's first class, which the tutorial has the student open. */
  isFirst?: boolean;
  /** The day view's fuller block: a chip, and whether the class is already over. */
  detail?: { chip: BlockChip | null; past: boolean };
  onPress: () => void;
}) {
  const theme = useTheme();
  const tutorialTarget = useTutorialTarget('firstClass', isFirst);
  const { event } = item;
  const ghost = edit === 'add';
  // Settled as not running: greyed out, its module colour gone, so it reads as not there.
  const cancelled = highlight?.kind === 'cancelled';
  const solid = !ghost && !cancelled;
  const width = columnWidth / item.columnCount;
  // Placed by the part the grid draws: a class running past 9pm is cut off at the last line.
  const span = GridHours.clip(event, hours);
  const top = ((span.start.getHours() - hours[0]) * 60 + span.start.getMinutes()) / 60 * hourHeight;
  const height = Math.max(26, (span.end.getTime() - span.start.getTime()) / 3_600_000 * hourHeight);
  const tint = moduleTint(theme, event.activity.moduleCode ?? titleOf(event));
  const ink = solid ? '#FFFFFF' : theme.ink;
  const inkSoft = solid ? 'rgba(255, 255, 255, 0.85)' : theme.inkSecondary;
  const first = parsedLocations(event)[0];
  const room = first ? first.buildingName ?? first.code : null;
  const spoken = [
    ghost ? 'Not in your timetable' : null,
    highlight ? highlightReason(highlight) : null,
    detail?.chip && !highlight ? detail.chip.text : null,
    ...due.map((d) => `Due at this class, ${deadlineKindLabel(d.kind)}: ${displayTitle(d)}`),
    titleOf(event),
    `${formatTime(event.start)} to ${formatTime(event.end)}`,
    detail ? activitySummary(event.activity) : null,
    locationDisplay(event),
    detail ? staffText(event) : null,
    isClashing ? 'Overlaps another class' : null,
    detail?.past ? 'Finished' : null,
  ].filter(Boolean).join(', ');

  return (
    <Pressable
      ref={tutorialTarget}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint={edit === 'add' ? 'Adds it to your timetable' : edit === 'remove' ? 'Removes it from your timetable' : 'Opens the class'}
      style={({ pressed }) => [
        styles.block,
        {
          left: item.column * width + BLOCK_GAP / 2 + 1,
          top: top + BLOCK_GAP / 2,
          width: Math.max(width - BLOCK_GAP - 2, 10),
          height: height - BLOCK_GAP,
          // A ghost is only an outline: there, but not yet the student's.
          backgroundColor: ghost ? withAlpha(tint, 0.06) : cancelled ? theme.raised : tint,
          borderColor: ghost ? withAlpha(tint, 0.7) : cancelled ? withAlpha(theme.inkTertiary, 0.4) : 'transparent',
          borderWidth: ghost || cancelled ? 1.5 : 0,
          borderStyle: ghost ? 'dashed' : 'solid',
          boxShadow: solid ? '0 1px 2px rgba(0, 0, 0, 0.12)' : undefined,
          opacity: pressed ? 0.75 : detail?.past ? 0.55 : 1,
        },
      ]}
    >
      {isOnline(event) ? (
        <Hatch color={solid ? 'rgba(255, 255, 255, 0.18)' : withAlpha(theme.tint.online, 0.28)} spacing={7} origin={{ x: item.column * width, y: top }} />
      ) : null}
      {detail ? (
        <DayBlockText event={event} height={height} due={due} chip={highlight ? chipFor(highlight, theme) : detail.chip} ink={ink} inkSoft={inkSoft} faded={ghost || cancelled} struck={cancelled} />
      ) : (
        <WeekBlockText event={event} height={height} room={room} ink={ink} inkSoft={inkSoft} faded={ghost || cancelled} />
      )}
      {edit ? (
        <View style={[styles.editMark, { backgroundColor: theme.surface }]}>
          <Icon name={edit} size={detail ? 22 : 14} color={edit === 'add' ? theme.accent : theme.tint.off} />
        </View>
      ) : null}
      {/* The "!" wins the corner: the badge for news is only one of the ways a class says so, but only this says something's due. */}
      {due.length > 0 ? (
        <View style={styles.corner}><DeadlineMark size={detail ? 18 : 16} /></View>
      ) : highlight && !detail ? (
        <View style={[styles.corner, styles.badge, { backgroundColor: '#FFFFFF' }]}>
          <Icon name={highlightIcon(highlight)} size={11} color={highlightTint(highlight, theme)} />
        </View>
      ) : isClashing ? (
        <View style={[styles.corner, styles.badge, { backgroundColor: '#FFFFFF' }]}>
          <Icon name="alert" size={11} color={theme.tint.off} />
        </View>
      ) : null}
    </Pressable>
  );
}

function chipFor(highlight: ClassHighlight, theme: ReturnType<typeof useTheme>): BlockChip {
  return { text: highlightReason(highlight), color: highlight.kind === 'cancelled' ? theme.inkSecondary : highlightTint(highlight, theme), icon: highlightIcon(highlight) };
}

/**
 * A week block's words: the name, wrapped into whatever height the class has, then its type
 * and room underneath when that still leaves the name two lines.
 */
function WeekBlockText({ event, height, room, ink, inkSoft, faded }: {
  event: TimetableEvent; height: number; room: string | null; ink: string; inkSoft: string; faded: boolean;
}) {
  const lines = Math.max(1, Math.floor((height - 8) / WEEK_LINE));
  const showsKind = lines >= 4;
  const showsRoom = room !== null && lines >= 3;
  const titleLines = Math.max(1, lines - (showsKind ? 1 : 0) - (showsRoom ? 1 : 0));
  return (
    <View style={[styles.weekText, faded && styles.faded]}>
      <Txt type="caption2" numberOfLines={titleLines} style={styles.bold} color={ink} maxFontSizeMultiplier={1.4}>
        {compactTitleOf(event)}
      </Txt>
      {showsKind ? <Txt type="caption2" numberOfLines={1} color={inkSoft} maxFontSizeMultiplier={1.4}>{kindLabel(event.activity.kind)}</Txt> : null}
      {showsRoom ? <Txt type="caption2" numberOfLines={1} color={inkSoft} maxFontSizeMultiplier={1.4}>{room}</Txt> : null}
    </View>
  );
}

/**
 * A day block's words, as many as its height holds, most useful first: the name, its times
 * and type, a chip (when it starts, or the news about it), the room, what's due, the lecturer.
 */
function DayBlockText({ event, height, due, chip, ink, inkSoft, faded, struck }: {
  event: TimetableEvent; height: number; due: Deadline[]; chip: BlockChip | null; ink: string; inkSoft: string; faded: boolean; struck: boolean;
}) {
  const room = locationDisplay(event) === '—' ? null : locationDisplay(event);
  const staff = staffText(event);
  // Lines after the name's first, handed out in order of use; whatever is over gives the name a second.
  const budget = Math.max(1, Math.floor((height - 14) / DAY_LINE)) - 1;
  const showsMeta = budget >= 1;
  const afterMeta = budget - (showsMeta ? 1 : 0);
  const showsChip = !!chip && afterMeta >= 1.4;
  const afterChip = afterMeta - (showsChip ? 1.4 : 0);
  const showsRoom = !!room && afterChip >= 1;
  const afterRoom = afterChip - (showsRoom ? 1 : 0);
  const shownDue = due.slice(0, Math.max(0, Math.floor(afterRoom)));
  const afterDue = afterRoom - shownDue.length;
  const showsStaff = !!staff && afterDue >= 1;
  const titleLines = afterDue - (showsStaff ? 1 : 0) >= 1 ? 2 : 1;
  return (
    <View style={[styles.dayText, faded && styles.faded]}>
      <Txt type="subheadline" numberOfLines={titleLines} color={ink} style={[styles.bold, struck && styles.struck]}>{shortTitleOf(event)}</Txt>
      {showsMeta ? (
        <Txt type="footnote" numberOfLines={1} color={inkSoft} style={styles.tabular}>
          {formatTime(event.start)} – {formatTime(event.end)} · {activitySummary(event.activity)}
        </Txt>
      ) : null}
      {showsRoom ? (
        <View style={styles.roomLine}>
          <Icon name={event.type === 'onCampus' ? 'place' : 'video'} size={13} color={inkSoft} />
          <Txt type="footnote" numberOfLines={1} color={inkSoft} style={styles.shrink}>{room}</Txt>
        </View>
      ) : null}
      {shownDue.map((d) => (
        <Txt key={d.id} type="footnote" numberOfLines={1} color={ink}>
          <Txt type="footnote" color={ink} style={styles.semibold}>{deadlineKindLabel(d.kind)}: </Txt>
          {displayTitle(d)}
        </Txt>
      ))}
      {showsStaff ? <Txt type="footnote" numberOfLines={1} color={inkSoft}>{staff}</Txt> : null}
      {showsChip && chip ? (
        <View style={styles.chip}>
          {chip.icon ? <Icon name={chip.icon} size={12} color={chip.color} /> : null}
          <Txt type="caption" color={chip.color} style={styles.semibold} numberOfLines={1}>{chip.text}</Txt>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Free time on the day grid, as a quiet grey block in the gap: "1 hour free". Drawn only when
 * the gap is tall enough to hold its words.
 */
export function FreeBlock({ start, end, label, hours, hourHeight, columnWidth }: {
  start: Date; end: Date; label: string; hours: number[]; hourHeight: number; columnWidth: number;
}) {
  const theme = useTheme();
  const top = ((start.getHours() - hours[0]) * 60 + start.getMinutes()) / 60 * hourHeight;
  const height = (end.getTime() - start.getTime()) / 3_600_000 * hourHeight;
  if (height < 26) return null;
  return (
    <View
      pointerEvents="none"
      style={[styles.free, { top: top + BLOCK_GAP / 2, height: height - BLOCK_GAP, width: columnWidth - BLOCK_GAP - 2, backgroundColor: theme.band }]}
      accessible
      accessibilityLabel={`${label}, from ${formatTime(start)}`}
    >
      <Txt type="footnote" color={theme.inkTertiary} style={styles.semibold}>{label}</Txt>
    </View>
  );
}

function hourLabel(hour: number): string {
  const suffix = hour < 12 ? 'am' : 'pm';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}${suffix}`;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  cardSides: { paddingHorizontal: Space.m, paddingTop: Space.xxs },
  card: { flex: 1, borderRadius: Radius.card + Space.xs, overflow: 'hidden' },
  macSides: { paddingHorizontal: MAC_SIDE },
  // No rule under the weekday names: the hour lines below are enough to start the grid.
  header: { flexDirection: 'row', paddingTop: Space.m, paddingBottom: Space.xs },
  dayHead: { alignItems: 'center', gap: 2 },
  bold: { fontWeight: '700' },
  semibold: { fontWeight: '600' },
  tabular: { fontVariant: ['tabular-nums'] },
  struck: { textDecorationLine: 'line-through' },
  disc: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  centred: { textAlign: 'center' },
  // Over the hours, clear of the weekday names.
  emptyOver: { position: 'absolute', left: 0, right: 0, bottom: 0, top: 56, alignItems: 'center', justifyContent: 'center', padding: Space.xl },
  emptyCard: { alignItems: 'center', gap: Space.xs, paddingHorizontal: Space.l, paddingVertical: Space.m, borderRadius: Radius.control },
  gridScroll: { paddingTop: Space.m },
  gridRow: { flexDirection: 'row' },
  // Placed like the hour lines, centred on its own line, so nothing accumulates down the column.
  hourLabel: { position: 'absolute', left: 0, right: 0, textAlign: 'right', paddingRight: Space.s },
  hourLine: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth },
  block: { position: 'absolute', borderRadius: Radius.block, overflow: 'hidden', flexDirection: 'row' },
  weekText: { flex: 1, alignSelf: 'flex-start', paddingHorizontal: 6, paddingVertical: 5, gap: 1 },
  dayText: { flex: 1, alignSelf: 'flex-start', paddingHorizontal: Space.m, paddingVertical: Space.s - 1, gap: 1 },
  roomLine: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  shrink: { flexShrink: 1 },
  chip: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: Space.xxs, marginTop: Space.xxs,
    backgroundColor: '#FFFFFF', borderRadius: 999, paddingHorizontal: Space.s, paddingVertical: 2,
  },
  corner: { position: 'absolute', top: 4, right: 4 },
  badge: { width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  faded: { opacity: 0.55 },
  // Bottom right, clear of the title: the end of the room is the least a block would lose.
  // Round, but for the corner it shares with the block: that one curves round the block's own
  // corner centre, a point in from its edge.
  editMark: { position: 'absolute', bottom: 2, right: 2, borderRadius: 12, borderBottomRightRadius: concentric(Radius.block, 2) },
  free: { position: 'absolute', left: BLOCK_GAP / 2 + 1, borderRadius: Radius.block, paddingHorizontal: Space.m, justifyContent: 'center' },
  now: { position: 'absolute', left: 0, right: 0, height: 0 },
  nowAcross: { position: 'absolute', top: -StyleSheet.hairlineWidth / 2, height: StyleSheet.hairlineWidth },
  nowToday: { position: 'absolute', top: -1, height: 2 },
  nowDot: { position: 'absolute', top: -NOW_DOT / 2, width: NOW_DOT, height: NOW_DOT, borderRadius: NOW_DOT / 2 },
  nowTime: { position: 'absolute', left: 0, width: GUTTER - 2, top: -7, textAlign: 'right', paddingRight: 2, fontWeight: '600' },
});
