import { router } from 'expo-router';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { AppState, Image, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { addDays, formatDayMonth, isSameDay, startOfDay } from '../../core/time';
import { WeekdayIndex } from '../../core/misc';
import { TimetableEvent } from '../../core/timetableEvent';
import { listenForMacAlertTaps, MacShell } from '../../data/macShell';
import { listenForAlertTaps } from '../../data/notifications';
import { PrefKey } from '../../data/storage';
import { useAppEvent, useModel, useNow, usePrefBool } from '../../state/hooks';
import { useRoot, useWeekModel } from '../../state/root';
import { BarButton, EmptyState, Icon, IconButton, Label, PrimaryButton, Spinner, SheetAction, Txt, useWide } from '../../ui/components';
import { DropdownMenu } from '../../ui/DropdownMenu';
import { Radius, Space, useTheme } from '../../ui/theme';
import { AccountSheet } from '../account/AccountSheet';
import { useTutorial, useTutorialTarget } from '../tutorial/Tutorial';
import { NotificationsSheet } from '../alerts/NotificationsSheet';
import { DayPage } from './DayPage';
import { DeadlinesWidget } from './DeadlinesWidget';
import { EditChoiceSheet, EditKind, PendingEdit } from './editing';
import { ExportCalendarCard } from './ExportCalendarCard';
import { Pager, PagerControl } from './Pager';
import { useTimetableEdit } from './TabBar';
import { WeekGridView } from './WeekGrid';

/** The timetable tab: the day on the rail, or the week as a grid. */
export function TimetableScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { shell, signOut } = useRoot();
  const model = useModel(useWeekModel());
  const now = useNow();
  const [prefersCalendar, setShowsCalendar] = usePrefBool(PrefKey.weekShowsCalendar);
  // A desktop window (the Mac app or a wide browser) is the week and the deadlines: the day list is a phone's view.
  const [inMacApp] = useState(() => MacShell.isPresent());
  const wide = useWide();
  const onDesktop = inMacApp || wide;
  const showsCalendar = onDesktop || prefersCalendar;
  const weekPager = useRef<PagerControl>(null);
  const weekBadgeRef = useRef<View | null>(null);
  const [sheet, setSheet] = useState<'menu' | 'weeks' | 'account' | 'alerts' | 'export' | null>(null);
  /** Edit timetable: the course's other classes show as ghosts, and a tap adds or removes. */
  const { editing, setEditing } = useTimetableEdit();
  const [pendingEdit, setPendingEdit] = useState<PendingEdit | null>(null);
  const tutorial = useTutorial();
  const viewToggle = useTutorialTarget('viewToggle');
  const more = useTutorialTarget('more');

  useEffect(() => {
    void model.start();
  }, [model]);

  // The tutorial waits for a week to point at.
  const hasWeek = !model.isLoading && model.weeks.length > 0;
  useEffect(() => {
    if (hasWeek) tutorial?.markReady();
  }, [hasWeek, tutorial]);

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
  const openMenu = () => {
    setSheet('menu');
    tutorial?.signal('menuOpened');
  };

  const menu: SheetAction[] = [
    { label: 'Edit timetable', icon: 'edit', onPress: () => setEditing(true) },
    { label: 'Account', icon: 'account', onPress: () => setSheet('account') },
    { label: 'Notifications', icon: 'bell', onPress: () => setSheet('alerts') },
    { label: 'Export to Calendar', icon: 'calendar', onPress: () => setSheet('export') },
    { label: 'Sign out', icon: 'swap', onPress: signOut },
  ];

  const weekActions: SheetAction[] = model.weeks.map((w, i) => ({
    label: `Week ${w.label} · ${formatDayMonth(w.firstDay)}`,
    selected: i === model.weekIndex,
    onPress: () => model.setWeekIndex(i),
  }));

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
        locked={tutorial ? !tutorial.swipeAllowed : false}
        onDragChange={tutorial?.setDragging}
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
        locked={tutorial ? !tutorial.swipeAllowed : false}
        onDragChange={tutorial?.setDragging}
        onIndexChange={(i) => {
          const { week, day } = WeekdayIndex.split(i);
          model.setDay(week, day);
          tutorial?.signal('daySwiped');
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
      <View
        style={[
          styles.bar,
          onDesktop && styles.barDesktop,
          { paddingTop: insets.top + (onDesktop ? Space.s : 0), borderBottomColor: theme.separator, backgroundColor: theme.canvas },
        ]}
      >
        {onDesktop ? (
          <>
            <View style={styles.desktopHeaderLeft} accessible accessibilityRole="header">
              <Txt type="title3" numberOfLines={1} style={styles.timetableName}>
                {editing ? 'Edit timetable' : shell?.title ?? ''}
              </Txt>
              <View style={[styles.headerDivider, { backgroundColor: theme.separator }]} />
              <View ref={weekBadgeRef} collapsable={false}>
                <Pressable
                  onPress={() => setSheet('weeks')}
                  accessibilityRole="button"
                  accessibilityLabel={`${model.weekLabel}, select week`}
                  style={({ pressed }) => [
                    styles.weekBadge,
                    {
                      backgroundColor: theme.raised,
                      borderColor: theme.separator,
                      opacity: pressed ? 0.75 : 1,
                    },
                  ]}
                >
                  <Txt type="subheadline" style={styles.semibold}>{model.weekLabel}</Txt>
                  <Icon name="dropdown" size={14} color={theme.inkSecondary} />
                </Pressable>
              </View>
              {model.campusName && !editing ? (
                <>
                  <View style={[styles.headerDivider, { backgroundColor: theme.separator }]} />
                  <Label icon="place" text={model.campusName} type="callout" color={theme.inkSecondary} style={styles.campusLabel} />
                </>
              ) : null}
            </View>
            <View style={styles.desktopHeaderCenter} pointerEvents="none">
              <Image
                source={require('../../../assets/splash-icon.png')}
                style={styles.dcuLogo}
                resizeMode="contain"
                accessibilityLabel="DCU Timetables"
              />
            </View>
            <View style={styles.desktopHeaderRight}>
              {editing ? <BarButton title="Done" bold onPress={() => setEditing(false)} /> : null}
            </View>
          </>
        ) : (
          <>
            <View ref={viewToggle} collapsable={false}>
              <IconButton
                icon={showsCalendar ? 'list' : 'calendar'}
                label={showsCalendar ? 'Show list' : 'Show weekly calendar'}
                onPress={() => {
                  setShowsCalendar(!showsCalendar);
                  if (!showsCalendar) tutorial?.signal('weekShown');
                }}
              />
            </View>
            <View style={styles.titleBlock} accessible accessibilityRole="header">
              <Txt type="headline" numberOfLines={1}>{editing ? 'Edit timetable' : shell?.title ?? ''}</Txt>
              <View style={styles.subtitle}>
                <Txt type="caption" color={theme.inkSecondary}>{model.weekLabel}</Txt>
                {model.campusName && !editing ? (
                  <Label icon="place" text={model.campusName} type="caption" color={theme.inkSecondary} />
                ) : null}
              </View>
            </View>
            {editing ? (
              <View style={styles.done}><BarButton title="Done" bold onPress={() => setEditing(false)} /></View>
            ) : (
              <View ref={more} collapsable={false}><IconButton icon="more" label="More" onPress={openMenu} /></View>
            )}
          </>
        )}
      </View>

      <View style={[styles.fill, onDesktop && styles.desktopBody]}>
        {onDesktop ? (
          <View style={[styles.widgetRail, { borderRightColor: theme.separator }]}>
            <DeadlinesWidget />
          </View>
        ) : null}
        <View style={styles.fill}>
          {body}
          {model.isLoading && model.events.length === 0 && !model.errorText ? (
            <View style={StyleSheet.absoluteFill} pointerEvents="none"><Spinner /></View>
          ) : null}
        </View>
      </View>

      {/* From the ⋯ at the top, where the student's finger already is. */}
      <DropdownMenu
        visible={sheet === 'menu'}
        anchor={more}
        onClose={() => {
          setSheet(null);
          tutorial?.signal('menuClosed');
        }}
        actions={menu}
      />
      <DropdownMenu
        visible={sheet === 'weeks'}
        anchor={weekBadgeRef}
        align="center"
        onClose={() => setSheet(null)}
        actions={weekActions}
      />
      <AccountSheet visible={sheet === 'account'} onClose={() => setSheet(null)} />
      <NotificationsSheet visible={sheet === 'alerts'} onClose={() => setSheet(null)} />
      <ExportCalendarCard visible={sheet === 'export'} onClose={() => setSheet(null)} />
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
  desktopBody: { flexDirection: 'row' },
  // Reserved on the left of a desktop window for widgets alongside the week grid.
  widgetRail: { width: '28%', minWidth: 300, maxWidth: 400, borderRightWidth: StyleSheet.hairlineWidth },
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Space.xs, paddingBottom: Space.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  barDesktop: { paddingHorizontal: Space.l, paddingBottom: Space.s, justifyContent: 'space-between', gap: Space.m },
  desktopHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: Space.m, flex: 1 },
  timetableName: { fontWeight: '600' },
  headerDivider: { width: StyleSheet.hairlineWidth, height: 22 },
  weekBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingHorizontal: Space.m,
    paddingVertical: 6,
    borderRadius: Radius.control,
    borderWidth: StyleSheet.hairlineWidth,
  },
  semibold: { fontWeight: '600' },
  campusLabel: { flex: 0 },
  desktopHeaderCenter: { alignItems: 'center', justifyContent: 'center' },
  dcuLogo: { width: 110, height: 40 },
  desktopHeaderRight: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: Space.xs },
  titleBlock: { flex: 1, alignItems: 'center' },
  subtitle: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  mobileWeekBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  // As wide as the button on the other side, so the title stays centred.
  done: { minWidth: 44, alignItems: 'flex-end', paddingRight: Space.xs },
});
