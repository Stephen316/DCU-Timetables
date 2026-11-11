import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { ClassHighlight, Deadline } from '../../core/deadline';
import { WeekGrid as Placement, DaySchedule, gapLabel, GridHours, NextClassWindow } from '../../core/schedule';
import { addDays, isToday, startOfWeek } from '../../core/time';
import { TimetableEvent } from '../../core/timetableEvent';
import { useTheme } from '../../ui/theme';
import { usePagerDrag } from './Pager';
import { EditKind } from './editing';
import { useTutorialTarget } from '../tutorial/Tutorial';
import { Block, BlockChip, DAY_HOUR, DeadlineMarkers, FreeBlock, TimeGrid } from './WeekGrid';

/**
 * One day of the timetable, drawn as the week is: the same card, the same weekday names across
 * the top (this day's filled violet, a tap on another goes there), the same hour lines, and the
 * same solid module-coloured blocks — one wide column, so each block also has room for its
 * times, type, room, lecturer and what's due at it. Free time between classes is a quiet grey
 * block saying how long. The class to head for carries a chip saying when it starts; classes
 * already over fade.
 */
export function DayPage({
  day, events, ghosts, editing, now, clashingIDs, highlight, dueAt, looseDeadlines, isLoading, onSelect, onEdit, onPick,
}: {
  /** What's due on this day that none of its classes carries, marked at its time. */
  looseDeadlines: (day: Date, shown: TimetableEvent[]) => Deadline[];
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
  /** Another weekday of the same week, tapped in the names across the top. */
  onPick: (day: Date) => void;
}) {
  const theme = useTheme();
  const pagerDrag = usePagerDrag();
  const dayList = useTutorialTarget('dayList');
  const dayHeading = useTutorialTarget('dayHeading');
  const today = day !== null && isToday(day, now);
  // The same rule the widget uses, so the app and the home screen never point at different classes.
  const nextID = today ? NextClassWindow.highlighted(events, now)?.id ?? null : null;
  // Only what falls between 8am and 9pm: the grid never draws the night.
  const classes = events.filter(GridHours.shows);
  const shown = editing ? [...classes, ...ghosts.filter(GridHours.shows)] : classes;
  const ghostIDs = new Set(editing ? ghosts.map((e) => e.id) : []);
  // Hidden while editing, which is about classes alone.
  const markers = day && !editing ? looseDeadlines(day, classes) : [];
  const hours = GridHours.including(GridHours.of(shown), markers.map((d) => d.due));
  const weekdays = day ? Array.from({ length: 5 }, (_, i) => addDays(startOfWeek(day), i)) : [];
  const gaps = editing ? [] : DaySchedule.slots(classes).flatMap((s) => (s.kind === 'gap' ? [s.gap] : []));

  const chipFor = (event: TimetableEvent): BlockChip | null => {
    if (event.id !== nextID) return null;
    if (now.getTime() >= event.start.getTime()) return { text: 'On now', color: theme.accent, icon: 'running' };
    const minutes = Math.ceil((event.start.getTime() - now.getTime()) / 60_000);
    if (minutes < 60) return { text: `Starts in ${minutes} min`, color: theme.accent };
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return { text: m === 0 ? `Starts in ${h} hr` : `Starts in ${h} hr ${m} min`, color: theme.accent };
  };

  return (
    <View ref={dayList} collapsable={false} style={styles.fill}>
      <TimeGrid
        heads={weekdays}
        columns={day ? [day] : []}
        hours={hours}
        hourHeight={DAY_HOUR}
        now={now}
        selected={day ?? undefined}
        onPick={(d) => !pagerDrag.isSuppressingTaps() && onPick(d)}
        headRef={dayHeading}
        empty={!isLoading && shown.length === 0 && markers.length === 0 ? {
          title: 'No classes',
          message: editing ? 'Your course has nothing on this day.' : 'Swipe left or right for the rest of the week.',
        } : null}
        renderColumn={(_, width) => (
          <>
            {gaps.map((gap) => (
              <FreeBlock
                key={gap.start.getTime()}
                start={gap.start}
                end={gap.end}
                label={gapLabel(gap)}
                hours={hours}
                hourHeight={DAY_HOUR}
                columnWidth={width}
              />
            ))}
            {Placement.place(shown).map((item) => {
              const edit: EditKind | undefined = !editing ? undefined : ghostIDs.has(item.event.id) ? 'add' : 'remove';
              return (
                <Block
                  key={`${edit ?? ''}${item.event.id}`}
                  item={item}
                  columnWidth={width}
                  hours={hours}
                  hourHeight={DAY_HOUR}
                  highlight={edit === 'add' ? null : highlight(item.event)}
                  due={edit === 'add' ? [] : dueAt(item.event)}
                  isClashing={!editing && clashingIDs.has(item.event.id)}
                  edit={edit}
                  detail={{
                    chip: edit ? null : chipFor(item.event),
                    past: !editing && today && item.event.end.getTime() <= now.getTime(),
                  }}
                  onPress={() => {
                    if (pagerDrag.isSuppressingTaps()) return;
                    if (edit) onEdit(item.event, edit);
                    else onSelect(item.event);
                  }}
                />
              );
            })}
            <DeadlineMarkers
              deadlines={markers}
              hours={hours}
              hourHeight={DAY_HOUR}
              columnWidth={width}
              onPress={() => !pagerDrag.isSuppressingTaps() && router.navigate('/deadlines')}
            />
          </>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
