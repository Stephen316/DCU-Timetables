import { router } from 'expo-router';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { addDays, isSameDay, startOfDay } from '../../core/time';
import { WeekdayIndex } from '../../core/misc';
import { TimetableEvent } from '../../core/timetableEvent';
import { listenForMacAlertTaps, MacShell } from '../../data/macShell';
import { listenForAlertTaps } from '../../data/notifications';
import { PrefKey } from '../../data/storage';
import { useAppEvent, useModel, useNow, usePrefBool } from '../../state/hooks';
import { useRoot, useWeekModel } from '../../state/root';
import { ActionSheet, BarButton, EmptyState, IconButton, Label, PrimaryButton, Spinner, SheetAction, Txt } from '../../ui/components';
import { Space, useTheme } from '../../ui/theme';
import { AccountSheet } from '../account/AccountSheet';
import { NotificationsSheet } from '../alerts/NotificationsSheet';
import { DayPage } from './DayPage';
import { EditChoiceSheet, EditKind, PendingEdit } from './editing';
import { Pager, PagerControl } from './Pager';
import { WeekGridView } from './WeekGrid';

/** The timetable tab: the day on the rail, or the week as a grid. */
export function TimetableScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { shell, signOut } = useRoot();
  const model = useModel(useWeekModel());
  const now = useNow();
  const [prefersCalendar, setShowsCalendar] = usePrefBool(PrefKey.weekShowsCalendar);
  // The Mac app is the week and the deadlines: the day list is a phone's view.
  const [onMac] = useState(() => MacShell.isPresent());
  const showsCalendar = onMac || prefersCalendar;
  const weekPager = useRef<PagerControl>(null);
  const [sheet, setSheet] = useState<'menu' | 'account' | 'alerts' | null>(null);
  /** Edit timetable: the course's other classes show as ghosts, and a tap adds or removes. */
  const [editing, setEditing] = useState(false);
  const [pendingEdit, setPendingEdit] = useState<PendingEdit | null>(null);

  useEffect(() => {
    void model.start();
  }, [model]);

  // Coming back to the app is a fresh look at the timetable, so start again from today (or
  // tomorrow evening) — but only after a real trip to the background, not Control Centre.
  const lastAppState = useRef(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (lastAppState.current === 'background' && next === 'active') model.resetToDefaultDay();
      // Alerts that have fired make room for later ones under iOS's limit.
      if (next === 'active') model.scheduleAlerts();
      lastAppState.current = next;
    });
    return () => sub.remove();
  }, [model]);

  // A tapped class alert opens that class, as a Calendar alert opens its event.
  useEffect(() => listenForAlertTaps((id) => router.push({ pathname: '/class/[id]', params: { id } })), []);
  useEffect(() => listenForMacAlertTaps((id) => router.push({ pathname: '/class/[id]', params: { id } })), []);

  useAppEvent('timetableChangesChanged', () => model.reloadChanges());
  useAppEvent('moduleSplitsChanged', () => model.reloadSplits());
  useAppEvent('moduleTitlesChanged', () => model.reloadTitles());
  useAppEvent('moduleAbbreviationsChanged', () => model.reloadAbbreviations());
  useAppEvent('labRotationChanged', () => void model.reloadAll());

  const open = (event: TimetableEvent) => router.push({ pathname: '/class/[id]', params: { id: event.id } });
  const askToEdit = (event: TimetableEvent, kind: EditKind) => setPendingEdit({ event, kind });

  const menu: SheetAction[] = [
    { label: 'Edit timetable', icon: 'edit', onPress: () => setEditing(true) },
    { label: 'Account', icon: 'account', onPress: () => setSheet('account') },
    { label: 'Notifications', icon: 'bell', onPress: () => setSheet('alerts') },
    { label: 'Sign out', icon: 'swap', onPress: signOut },
  ];

  let body: ReactNode;
  if (model.errorText && model.events.length === 0) {
    body = (
      <EmptyState
        icon="offline"
        title="Couldn't load this week"
        message={model.errorText}
        action={<PrimaryButton title="Try again" onPress={() => void model.start()} />}
      />
    );
  } else if (showsCalendar) {
    // Same pager as the day view — weeks instead of days, stopping at the ends of the year.
    body = (
      <Pager
        count={Math.max(model.weeks.length, 1)}
        index={model.weekIndex}
        onIndexChange={(i) => model.setWeekIndex(i)}
        controlRef={weekPager}
        renderPage={(i) => (
          <WeekGridView
            eventsByDay={model.eventsByDayForWeekIndex(i)}
            ghostsByDay={editing ? model.ghostsByDayForWeekIndex(i) : []}
            editing={editing}
            weekStart={model.weeks[i]?.firstDay ?? null}
            clashingIDs={model.clashingIDs}
            highlight={(e) => model.highlight(e)}
            dueAt={(e) => model.dueAt(e)}
            onSelect={open}
            onEdit={askToEdit}
            now={now}
          />
        )}
      />
    );
  } else {
    body = (
      // Every weekday of the year in one run, so Friday swipes on to the next week's Monday.
      <Pager
        count={Math.max(model.weeks.length * WeekdayIndex.daysPerWeek, 1)}
        index={WeekdayIndex.flat(model.weekIndex, model.dayIndex)}
        swipe="easy"
        onIndexChange={(i) => {
          const { week, day } = WeekdayIndex.split(i);
          model.setDay(week, day);
        }}
        renderPage={(i) => {
          const { week, day: offset } = WeekdayIndex.split(i);
          const firstDay = model.weeks[week]?.firstDay;
          const day = firstDay ? addDays(startOfDay(firstDay), offset) : null;
          return (
            <DayPage
              day={day}
              events={day ? model.eventsByDayForWeekIndex(week).find((d) => isSameDay(d.day, day))?.events ?? [] : []}
              ghosts={day && editing ? model.ghostsByDayForWeekIndex(week).find((d) => isSameDay(d.day, day))?.events ?? [] : []}
              editing={editing}
              now={now}
              clashingIDs={model.clashingIDs}
              highlight={(e) => model.highlight(e)}
              dueAt={(e) => model.dueAt(e)}
              isLoading={model.isLoading}
              onSelect={open}
              onEdit={askToEdit}
            />
          );
        }}
      />
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: theme.canvas }]}>
      <View style={[styles.bar, { paddingTop: insets.top, borderBottomColor: theme.separator, backgroundColor: theme.canvas }]}>
        {onMac ? (
          <View style={styles.side}>
            <IconButton icon="back" label="Previous week" onPress={() => weekPager.current?.turn(-1)} />
            <IconButton icon="forward" label="Next week" onPress={() => weekPager.current?.turn(1)} />
          </View>
        ) : (
          <IconButton
            icon={showsCalendar ? 'list' : 'calendar'}
            label={showsCalendar ? 'Show list' : 'Show weekly calendar'}
            onPress={() => setShowsCalendar(!showsCalendar)}
          />
        )}
        <View style={styles.titleBlock} accessible accessibilityRole="header">
          <Txt type="headline" numberOfLines={1}>{editing ? 'Edit timetable' : shell?.title ?? ''}</Txt>
          <View style={styles.subtitle}>
            <Txt type="caption" color={theme.inkSecondary}>{model.weekLabel}</Txt>
            {model.campusName && !editing ? <Label icon="place" text={model.campusName} type="caption" color={theme.inkSecondary} /> : null}
          </View>
        </View>
        {editing ? (
          <View style={[styles.done, onMac && styles.side, onMac && styles.sideRight]}><BarButton title="Done" bold onPress={() => setEditing(false)} /></View>
        ) : onMac ? (
          <View style={[styles.side, styles.sideRight]}>
            <BarButton title="Today" onPress={() => model.showCurrentWeek()} />
            <IconButton icon="more" label="More" onPress={() => setSheet('menu')} />
          </View>
        ) : (
          <IconButton icon="more" label="More" onPress={() => setSheet('menu')} />
        )}
      </View>

      <View style={styles.fill}>
        {body}
        {model.isLoading && model.events.length === 0 && !model.errorText ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="none"><Spinner /></View>
        ) : null}
      </View>

      <ActionSheet visible={sheet === 'menu'} onClose={() => setSheet(null)} actions={menu} />
      <AccountSheet visible={sheet === 'account'} onClose={() => setSheet(null)} />
      <NotificationsSheet visible={sheet === 'alerts'} onClose={() => setSheet(null)} />
      <EditChoiceSheet
        pending={pendingEdit}
        onChoose={({ event, kind }, repeat) => model.edit(kind, repeat, event)}
        onClose={() => setPendingEdit(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Space.xs, paddingBottom: Space.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  titleBlock: { flex: 1, alignItems: 'center' },
  subtitle: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  // As wide as the button on the other side, so the title stays centred.
  done: { minWidth: 44, alignItems: 'flex-end', paddingRight: Space.xs },
  // The Mac's pairs: the same width each side, for the same reason.
  side: { flexDirection: 'row', alignItems: 'center', minWidth: 120 },
  sideRight: { justifyContent: 'flex-end' },
});
