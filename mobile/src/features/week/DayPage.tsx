import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ClassHighlight, Deadline, deadlineKindLabel, displayTitle, highlightReason } from '../../core/deadline';
import { activitySummary } from '../../core/activityCode';
import { locationDisplay } from '../../core/roomLocation';
import { DaySchedule, DaySlot, gapLabel, NextClassWindow, slotID } from '../../core/schedule';
import { formatDayMonth, formatTime, isToday, isTomorrow, weekdayName } from '../../core/time';
import { eventTypeLabel, isOnline, shortTitleOf, staffText, TimetableEvent } from '../../core/timetableEvent';
import { DeadlineMark, Hatch, Icon, Label, Txt } from '../../ui/components';
import { highlightIcon, highlightTint } from '../../ui/meaning';
import { useTabBarClearance } from '../../ui/floatingBar';
import { Desktop, moduleTint, Radius, Space, useTheme, withAlpha } from '../../ui/theme';
import { usePagerDrag } from './Pager';
import { EditKind } from './editing';
import { useTutorialTarget } from '../tutorial/Tutorial';

/** What a class card is, which decides how it is drawn. */
type Stop =
  | { kind: 'upcoming' }
  /** The class to head for. `live` while it's on. */
  | { kind: 'next'; live: boolean }
  | { kind: 'past' }
  /** Carries news: reported cancelled, moved, a test, something due. */
  | { kind: 'flagged'; color: string }
  | { kind: 'cancelled' }
  /** A class of the course that isn't in the student's timetable, shown while they edit it. */
  | { kind: 'ghost' };

/**
 * One day of the timetable, as the week grid draws it: each class a solid card in its
 * module's colour with white type, free time a quiet grey pill between them. The weekday is
 * set large above, and the class to be heading to carries a chip saying when it starts.
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
  const clearance = useTabBarClearance();
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
  const dayList = useTutorialTarget('dayList');

  const stopFor = (event: TimetableEvent): Stop => {
    // News outranks "next": a class you'd otherwise be walking to is greyed out once it's
    // settled as cancelled, and drawn in orange while it's only reported or has moved.
    const h = highlight(event);
    if (h?.kind === 'cancelled') return { kind: 'cancelled' };
    if (h) return { kind: 'flagged', color: highlightTint(h, theme) };
    if (event.id === nextID) return { kind: 'next', live: now.getTime() >= event.start.getTime() && now.getTime() < event.end.getTime() };
    if (today && event.end.getTime() <= now.getTime()) return { kind: 'past' };
    return { kind: 'upcoming' };
  };

  return (
    <ScrollView style={{ backgroundColor: theme.canvas }} contentContainerStyle={[styles.content, { paddingBottom: clearance }]} showsVerticalScrollIndicator={false}>
      <DayHeading day={day} slots={slots} now={now} />
      {editing ? (
        editRows.length === 0 ? (
          <View style={styles.empty}>
            <Txt type="title3">No classes</Txt>
            <Txt type="subheadline" color={theme.inkSecondary}>Your course has nothing on this day.</Txt>
          </View>
        ) : (
          <View style={styles.rail}>
            {editRows.map((row) => (
              <ClassStop
                key={`${row.kind}-${row.event.id}`}
                event={row.event}
                stop={row.kind === 'add' ? { kind: 'ghost' } : stopFor(row.event)}
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
        <View ref={dayList} collapsable={false} style={styles.rail}>
          {slots.map((slot: DaySlot) =>
            slot.kind === 'session' ? (
              <ClassStop
                key={slotID(slot)}
                event={slot.event}
                stop={stopFor(slot.event)}
                highlight={highlight(slot.event)}
                due={dueAt(slot.event)}
                isClashing={clashingIDs.has(slot.event.id)}
                now={now}
                onSelect={() => onSelect(slot.event)}
              />
            ) : (
              <View key={slotID(slot)} style={[styles.gap, { backgroundColor: theme.raised }]} accessible accessibilityLabel={`${gapLabel(slot.gap)}, from ${formatTime(slot.gap.start)}`}>
                <Txt type="subheadline" color={theme.inkTertiary} style={styles.gapText}>{gapLabel(slot.gap)}</Txt>
                <Txt type="footnote" color={theme.inkTertiary} style={styles.tabular}>{formatTime(slot.gap.start)}</Txt>
              </View>
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
  const tutorialTarget = useTutorialTarget('dayHeading');
  return (
    <View ref={tutorialTarget} collapsable={false} style={styles.heading} accessible accessibilityRole="header">
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

/** A class as a card: tap to open its page. */
function ClassStop({
  event, stop, highlight, due, isClashing, now, edit, onSelect,
}: {
  event: TimetableEvent;
  stop: Stop;
  highlight: ClassHighlight | null;
  /** Deadlines due at this class — listed on its card, and nowhere when there are none. */
  due: Deadline[];
  isClashing: boolean;
  now: Date;
  /** Set while editing: what a tap does to the student's timetable. */
  edit?: EditKind;
  onSelect: () => void;
}) {
  const theme = useTheme();
  const pagerDrag = usePagerDrag();

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
  const news = highlight && (highlight.kind === 'cancelled' || highlight.kind === 'reported' || highlight.kind === 'moved') ? highlight : null;
  const dueLines = due.map((d) => `${deadlineKindLabel(d.kind)}: ${displayTitle(d)}`);

  // Solid in the module's colour while the class is on; grey once it's over or off, and a
  // dashed outline while it is only a candidate in edit mode.
  const tint = moduleTint(theme, event.activity.moduleCode ?? shortTitleOf(event));
  const muted = stop.kind === 'cancelled' || stop.kind === 'past';
  const ghost = stop.kind === 'ghost';
  const solid = !muted && !ghost;
  const ink = solid ? '#FFFFFF' : theme.ink;
  const inkSoft = solid ? '#FFFFFFD9' : theme.inkSecondary;

  const spoken = [
    ghost ? 'Not in your timetable' : null,
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
      style={({ pressed }) => [
        styles.card,
        solid
          ? { backgroundColor: tint }
          : ghost
            ? { backgroundColor: withAlpha(tint, 0.06), borderColor: withAlpha(tint, 0.7), borderWidth: 1.5, borderStyle: 'dashed' }
            : { backgroundColor: theme.raised, opacity: stop.kind === 'cancelled' ? 0.7 : 0.8 },
        { opacity: pressed ? 0.85 : muted ? 0.75 : 1 },
      ]}
    >
      {isOnline(event) && solid ? <Hatch color={withAlpha('#FFFFFF', 0.16)} spacing={8} origin={{ x: 0, y: 0 }} /> : null}
      <View style={styles.cardTop}>
        <Txt type="headline" color={ink} style={[styles.title, stop.kind === 'cancelled' && styles.struck]}>{shortTitleOf(event)}</Txt>
        <Txt type="footnote" color={inkSoft} style={styles.tabular}>{formatTime(event.start)} – {formatTime(event.end)}</Txt>
      </View>
      <Txt type="subheadline" color={inkSoft}>{activitySummary(event.activity)}</Txt>

      {due.map((d) => (
        <Txt key={d.id} type="footnote" color={ink} numberOfLines={2}>
          <Txt type="footnote" color={ink} style={styles.dueKind}>{deadlineKindLabel(d.kind)}: </Txt>
          {displayTitle(d)}
        </Txt>
      ))}
      {place ? <Label icon={event.type === 'onCampus' ? 'place' : 'video'} text={place} type="footnote" color={inkSoft} /> : null}
      {staffText(event) ? <Txt type="footnote" color={inkSoft}>{staffText(event)}</Txt> : null}

      {/* Status as white chips on the card rather than outlines: they read on every colour. */}
      {news || stop.kind === 'next' || due.length > 0 || isClashing ? (
        <View style={styles.chips}>
          {news ? (
            <Chip icon={highlightIcon(news)} text={highlightReason(news)} color={news.kind === 'cancelled' ? theme.inkSecondary : highlightTint(news, theme)} />
          ) : stop.kind === 'next' ? (
            <Chip text={nextLine} color={tint} />
          ) : null}
          {due.length > 0 ? <DeadlineMark size={18} /> : null}
          {isClashing ? <Chip icon="warning" text="Overlaps another class" color={theme.tint.off} /> : null}
        </View>
      ) : null}

      {edit ? (
        <View style={styles.editMark}>
          <Icon name={edit} size={24} color={edit === 'add' ? tint : theme.tint.off} />
        </View>
      ) : null}
    </Pressable>
  );
}

/** A white pill on a coloured card. */
function Chip({ icon, text, color }: { icon?: Parameters<typeof Icon>[0]['name']; text: string; color: string }) {
  return (
    <View style={styles.chip}>
      {icon ? <Icon name={icon} size={13} color={color} /> : null}
      <Txt type="caption" color={color} style={styles.chipText}>{text}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: Space.xxl, width: '100%', maxWidth: Desktop.readable, alignSelf: 'center' },
  heading: { paddingHorizontal: Space.l, paddingTop: Space.s, paddingBottom: Space.l, gap: Space.xxs },
  headingLine: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: Space.s },
  empty: { paddingHorizontal: Space.l, gap: Space.xs },
  rail: { paddingHorizontal: Space.l, gap: Space.s },
  card: { borderRadius: Radius.card, paddingHorizontal: Space.l, paddingVertical: Space.m, gap: Space.xxs, overflow: 'hidden',
          shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Space.s },
  gap: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: Radius.control, paddingHorizontal: Space.l, paddingVertical: Space.s },
  gapText: { fontWeight: '600' },
  tabular: { fontVariant: ['tabular-nums'] },
  struck: { textDecorationLine: 'line-through' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Space.xs, marginTop: Space.xs },
  chip: { flexDirection: 'row', alignItems: 'center', gap: Space.xxs, backgroundColor: '#FFFFFF', borderRadius: 999, paddingHorizontal: Space.s, paddingVertical: 2 },
  chipText: { fontWeight: '600' },
  editMark: { position: 'absolute', right: Space.m, bottom: Space.m, backgroundColor: '#FFFFFF', borderRadius: 14, padding: 1 },
  titleLine: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.s },
  // The + or − sits beside the class, outside its fade, so a ghost's is as clear as any.
  editLine: { flexDirection: 'row', alignItems: 'center', gap: Space.s },
  fill: { flex: 1 },
  faded: { gap: Space.xxs },
  title: { flex: 1 },
  // Sits on the headline's first line rather than its top edge.
  mark: { paddingTop: 3 },
  dueKind: { fontWeight: '600' },
});
