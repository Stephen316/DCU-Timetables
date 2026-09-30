import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ClassHighlight, Deadline, deadlineKindLabel, displayTitle, highlightReason } from '../../core/deadline';
import { activitySummary } from '../../core/activityCode';
import { locationDisplay } from '../../core/roomLocation';
import { DaySchedule, DaySlot, gapLabel, NextClassWindow, slotID } from '../../core/schedule';
import { formatDayMonth, formatTime, isToday, isTomorrow, weekdayName } from '../../core/time';
import { eventTypeLabel, isOnline, shortTitleOf, staffText, TimetableEvent } from '../../core/timetableEvent';
import { DeadlineMark, Icon, Label, Txt } from '../../ui/components';
import { highlightIcon, highlightTint } from '../../ui/meaning';
import { Space, useTheme } from '../../ui/theme';
import { usePagerDrag } from './Pager';
import { EditKind } from './editing';
import { RailGap, RailRow, railPosition, RailStop } from './Rail';

/**
 * One day of the timetable, drawn on the rail. The screen the app is opened for, so the
 * one place the design is allowed to be loud: the weekday set large, times as a clock down
 * the left, and the class to be heading to picked out in the accent.
 */
export function DayPage({
  day, events, ghosts, editing, now, clashingIDs, highlight, dueAt, isLoading, onSelect, onEdit,
}: {
  day: Date | null;
  events: TimetableEvent[];
  /** The course's classes on this day that aren't the student's, shown while editing. */
  ghosts: TimetableEvent[];
  /** Edit timetable is on: every class says whether a tap adds it or drops it. */
  editing: boolean;
  now: Date;
  clashingIDs: Set<string>;
  highlight: (event: TimetableEvent) => ClassHighlight | null;
  /** What's due at this class on its day. */
  dueAt: (event: TimetableEvent) => Deadline[];
  /** Holds back the empty state while the week is still arriving. */
  isLoading: boolean;
  onSelect: (event: TimetableEvent) => void;
  onEdit: (event: TimetableEvent, kind: EditKind) => void;
}) {
  const theme = useTheme();
  const slots = DaySchedule.slots(events);
  // While editing, the day is every class it could hold, the student's and the course's
  // others in time order, with no free time between: what's free depends on the edit.
  const editRows = editing
    ? [...events.map((event) => ({ event, kind: 'remove' as const })), ...ghosts.map((event) => ({ event, kind: 'add' as const }))]
        .sort((a, b) => a.event.start.getTime() - b.event.start.getTime())
    : [];
  const sessions = slots.flatMap((s) => (s.kind === 'session' ? [s.event] : []));
  const today = day !== null && isToday(day, now);
  // The same rule the widget uses, so the app and the home screen never point at different classes.
  const nextID = today ? NextClassWindow.highlighted(sessions, now)?.id ?? null : null;

  const stopFor = (event: TimetableEvent): RailStop => {
    // News outranks "next": a cancelled class you'd otherwise be walking to is drawn in orange.
    const h = highlight(event);
    if (h) return { kind: 'flagged', color: highlightTint(h, theme) };
    if (event.id === nextID) return { kind: 'next', live: now.getTime() >= event.start.getTime() && now.getTime() < event.end.getTime() };
    if (today && event.end.getTime() <= now.getTime()) return { kind: 'past' };
    return { kind: 'upcoming' };
  };

  return (
    <ScrollView style={{ backgroundColor: theme.canvas }} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <DayHeading day={day} slots={slots} now={now} />
      {editing ? (
        editRows.length === 0 ? (
          <View style={styles.empty}>
            <Txt type="title3">No classes</Txt>
            <Txt type="subheadline" color={theme.inkSecondary}>Your course has nothing on this day.</Txt>
          </View>
        ) : (
          <View style={styles.rail}>
            {editRows.map((row, i) => (
              <ClassStop
                key={`${row.kind}-${row.event.id}`}
                event={row.event}
                stop={row.kind === 'add' ? { kind: 'ghost' } : stopFor(row.event)}
                index={i}
                followsClass={i > 0}
                count={editRows.length}
                highlight={row.kind === 'add' ? null : highlight(row.event)}
                due={row.kind === 'add' ? [] : dueAt(row.event)}
                isClashing={false}
                now={now}
                edit={row.kind}
                onSelect={() => onEdit(row.event, row.kind)}
              />
            ))}
          </View>
        )
      ) : sessions.length === 0 ? (
        !isLoading ? (
          <View style={styles.empty}>
            <Txt type="title3">No classes</Txt>
            <Txt type="subheadline" color={theme.inkSecondary}>Swipe left or right for the rest of the week.</Txt>
          </View>
        ) : null
      ) : (
        <View style={styles.rail}>
          {slots.map((slot: DaySlot, i) =>
            slot.kind === 'session' ? (
              <ClassStop
                key={slotID(slot)}
                event={slot.event}
                stop={stopFor(slot.event)}
                index={i}
                followsClass={slots[i - 1]?.kind === 'session'}
                count={slots.length}
                highlight={highlight(slot.event)}
                due={dueAt(slot.event)}
                isClashing={clashingIDs.has(slot.event.id)}
                now={now}
                onSelect={() => onSelect(slot.event)}
              />
            ) : (
              <RailGap key={slotID(slot)} start={slot.gap.start} end={slot.gap.end} label={gapLabel(slot.gap)} />
            ),
          )}
        </View>
      )}
    </ScrollView>
  );
}

/** "Wednesday", large, with the date and the day's free time under it. */
function DayHeading({ day, slots, now }: { day: Date | null; slots: DaySlot[]; now: Date }) {
  const theme = useTheme();
  let dateLine = '';
  if (day) {
    const date = formatDayMonth(day);
    dateLine = isToday(day, now) ? `Today, ${date}` : isTomorrow(day, now) ? `Tomorrow, ${date}` : date;
  }
  const free = DaySchedule.freeMinutes(slots);
  return (
    <View style={styles.heading} accessible accessibilityRole="header">
      <Txt type="dayName" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{day ? weekdayName(day) : ''}</Txt>
      <View style={styles.headingLine}>
        <Txt type="subheadline" color={theme.inkSecondary}>{dateLine}</Txt>
        {free > 0 ? (
          <Txt type="subheadline" color={theme.inkSecondary}>{DaySchedule.freeLabel(free)} between classes</Txt>
        ) : null}
      </View>
    </View>
  );
}

/** A class on the rail: tap to open its page. */
function ClassStop({
  event, stop, index, count, followsClass, highlight, due, isClashing, now, edit, onSelect,
}: {
  event: TimetableEvent;
  stop: RailStop;
  index: number;
  count: number;
  /** Straight after another class, with no free time between to separate them. */
  followsClass: boolean;
  highlight: ClassHighlight | null;
  /** Deadlines due at this class — listed in its description, and nowhere when there are none. */
  due: Deadline[];
  isClashing: boolean;
  now: Date;
  /** Set while editing: what a tap does to the student's timetable. */
  edit?: EditKind;
  onSelect: () => void;
}) {
  const theme = useTheme();
  const pagerDrag = usePagerDrag();
  const [top, setTop] = useState(0);

  // The room, and how it's delivered only when that isn't "in the room".
  const room = locationDisplay(event) === '—' ? '' : locationDisplay(event);
  const delivery = event.type === 'onCampus' ? null : eventTypeLabel(event.type);
  const placeParts = [room || null, delivery].filter((p): p is string => p !== null);
  const place = placeParts.length > 0 ? placeParts.join(', ') : null;

  const nextLine = (() => {
    if (now.getTime() >= event.start.getTime()) return 'On now';
    const minutes = Math.ceil((event.start.getTime() - now.getTime()) / 60_000);
    if (minutes < 60) return `Starts in ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest === 0 ? `Starts in ${hours} hr` : `Starts in ${hours} hr ${rest} min`;
  })();

  // A deadline has its own lines below, so only a cancellation or a move takes the status line.
  const news = highlight && (highlight.kind === 'cancelled' || highlight.kind === 'moved') ? highlight : null;
  const dueLines = due.map((d) => `${deadlineKindLabel(d.kind)}: ${displayTitle(d)}`);

  const spoken = [
    stop.kind === 'ghost' ? 'Not in your timetable' : null,
    news ? highlightReason(news) : stop.kind === 'next' ? nextLine : null,
    ...dueLines.map((line) => `Due at this class, ${line}`),
    shortTitleOf(event),
    `${formatTime(event.start)} to ${formatTime(event.end)}`,
    activitySummary(event.activity),
    place,
    isClashing ? 'Overlaps another class' : null,
    stop.kind === 'past' ? 'Finished' : null,
  ].filter(Boolean).join(', ');

  return (
    <Pressable
      // Read at tap time: a swipe that ends on this row must not open it.
      onPress={() => !pagerDrag.isSuppressingTaps() && onSelect()}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint={edit === 'add' ? 'Adds it to your timetable' : edit === 'remove' ? 'Removes it from your timetable' : 'Opens the class'}
      style={({ pressed }) => pressed && { backgroundColor: theme.raised }}
      onLayout={(e) => setTop(e.nativeEvent.layout.y)}
    >
      <RailRow start={event.start} end={event.end} stop={stop} position={railPosition(index, count)} divider={followsClass} online={isOnline(event)} top={top}>
        <View style={styles.editLine}>
          <View style={[styles.fill, { gap: Space.xxs, opacity: stop.kind === 'ghost' ? 0.45 : stop.kind === 'past' ? 0.6 : 1 }]}>
            {news ? (
              <Label icon={highlightIcon(news)} text={highlightReason(news)} type="status" color={highlightTint(news, theme)} />
            ) : stop.kind === 'next' ? (
              <Txt type="status" color={theme.accent}>{nextLine}</Txt>
            ) : null}

            <View style={styles.titleLine}>
              <Txt type="headline" style={styles.title}>{shortTitleOf(event)}</Txt>
              {due.length > 0 ? <View style={styles.mark}><DeadlineMark /></View> : null}
              {isClashing ? <Icon name="warning" size={16} color={theme.tint.off} /> : null}
            </View>

            <Txt type="subheadline" color={theme.inkSecondary}>{activitySummary(event.activity)}</Txt>

            {due.map((d) => (
              <Txt key={d.id} type="footnote" color={theme.tint.test} numberOfLines={2}>
                <Txt type="footnote" color={theme.tint.test} style={styles.dueKind}>{deadlineKindLabel(d.kind)}: </Txt>
                {displayTitle(d)}
              </Txt>
            ))}

            {place ? (
              <Label icon={event.type === 'onCampus' ? 'place' : 'video'} text={place} type="footnote" color={theme.inkSecondary} />
            ) : null}

            {staffText(event) ? <Txt type="footnote" color={theme.inkTertiary}>{staffText(event)}</Txt> : null}
          </View>
          {edit ? <Icon name={edit} size={26} color={edit === 'add' ? theme.accent : theme.tint.off} /> : null}
        </View>
      </RailRow>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: Space.xxl },
  heading: { paddingHorizontal: Space.l, paddingTop: Space.s, paddingBottom: Space.l, gap: Space.xxs },
  headingLine: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: Space.s },
  empty: { paddingHorizontal: Space.l, gap: Space.xs },
  rail: { paddingLeft: Space.l },
  titleLine: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.s },
  // The + or − sits beside the class, outside its fade, so a ghost's is as clear as any.
  editLine: { flexDirection: 'row', alignItems: 'center', gap: Space.s },
  fill: { flex: 1 },
  title: { flex: 1 },
  // Sits on the headline's first line rather than its top edge.
  mark: { paddingTop: 3 },
  dueKind: { fontWeight: '600' },
});
