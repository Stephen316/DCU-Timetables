import { router } from 'expo-router';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { addDays, isSameDay, startOfDay } from '../../core/time';
import { TimetableEvent } from '../../core/timetableEvent';
import { PrefKey } from '../../data/storage';
import { useAppEvent, useModel, useNow, usePrefBool, usePrefJSON } from '../../state/hooks';
import { useRoot, useWeekModel } from '../../state/root';
import { ActionSheet, EmptyState, IconButton, Label, PrimaryButton, Spinner, SheetAction, Txt } from '../../ui/components';
import { Space, useTheme } from '../../ui/theme';
import { AccountSheet } from '../account/AccountSheet';
import { GroupsSheet } from '../groups/GroupsSheet';
import { LabsSheet } from '../labs/LabsSheet';
import { DayPage } from './DayPage';
import { Pager } from './Pager';
import { WeekGridView } from './WeekGrid';
import { WeekModel } from './WeekModel';

/** The timetable tab: the day on the rail, or the week as a grid. */
export function TimetableScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { shell, signOut } = useRoot();
  const model = useModel(useWeekModel());
  const now = useNow();
  const [showsCalendar, setShowsCalendar] = usePrefBool(PrefKey.weekShowsCalendar);
  const [hiddenGroups] = usePrefJSON<string[]>(PrefKey.hiddenGroups, []);
  const [skipped] = usePrefJSON<string[]>(PrefKey.skipped, []);
  const [sheet, setSheet] = useState<'menu' | 'groups' | 'labs' | 'account' | null>(null);

  useEffect(() => {
    void model.start();
  }, [model]);

  // Coming back to the app is a fresh look at the timetable, so start again from today (or
  // tomorrow evening) — but only after a real trip to the background, not Control Centre.
  const lastAppState = useRef(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (lastAppState.current === 'background' && next === 'active') model.resetToDefaultDay();
      lastAppState.current = next;
    });
    return () => sub.remove();
  }, [model]);

  useAppEvent('timetableChangesChanged', () => model.reloadChanges());
  useAppEvent('labRotationChanged', () => void model.reloadAll());

  const hiddenKey = hiddenGroups.join('\n');
  const firstHidden = useRef(true);
  useEffect(() => {
    if (firstHidden.current) {
      firstHidden.current = false;
      return;
    }
    model.updateHiddenGroups(new Set(hiddenGroups));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenKey, model]);

  const open = (event: TimetableEvent) => router.push({ pathname: '/class/[id]', params: { id: event.id } });

  const weekDays = model.weekStart
    ? Array.from({ length: 5 }, (_, i) => addDays(startOfDay(model.weekStart!), i))
    : [];
  const skippedSet = new Set(skipped);

  const menu: SheetAction[] = [
    ...(!shell?.groupsAssigned
      ? [
          { label: 'Select groups', icon: 'groups' as const, onPress: () => setSheet('groups') },
          ...(model.hasEngineeringLabs ? [{ label: 'Engineering labs', icon: 'labs' as const, onPress: () => setSheet('labs') }] : []),
        ]
      : []),
    { label: 'Account', icon: 'account', onPress: () => setSheet('account') },
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
        bounds={WeekModel.weekBounds}
        onIndexChange={(i) => model.setWeekIndex(i)}
        renderPage={(i) => (
          <WeekGridView
            eventsByDay={model.eventsByDayForWeekIndex(i)}
            weekStart={model.weeks[i]?.firstDay ?? null}
            clashingIDs={model.clashingIDs}
            highlight={(e) => model.highlight(e)}
            onSelect={open}
            now={now}
          />
        )}
      />
    );
  } else {
    body = (
      <Pager
        count={Math.max(weekDays.length, 1)}
        index={model.dayIndex}
        onIndexChange={(i) => model.setDayIndex(i)}
        renderPage={(i) => {
          const day = weekDays[i] ?? null;
          return (
            <DayPage
              day={day}
              events={day ? model.eventsByDay.find((d) => isSameDay(d.day, day))?.events ?? [] : []}
              now={now}
              clashingIDs={model.clashingIDs}
              highlight={(e) => model.highlight(e)}
              skipped={skippedSet}
              isLoading={model.isLoading}
              onSelect={open}
            />
          );
        }}
      />
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: theme.canvas }]}>
      <View style={[styles.bar, { paddingTop: insets.top, borderBottomColor: theme.separator, backgroundColor: theme.canvas }]}>
        <IconButton
          icon={showsCalendar ? 'list' : 'calendar'}
          label={showsCalendar ? 'Show list' : 'Show weekly calendar'}
          onPress={() => setShowsCalendar(!showsCalendar)}
        />
        <View style={styles.titleBlock} accessible accessibilityRole="header">
          <Txt type="headline" numberOfLines={1}>{shell?.title ?? ''}</Txt>
          <View style={styles.subtitle}>
            <Txt type="caption" color={theme.inkSecondary}>{model.weekLabel}</Txt>
            {model.campusName ? <Label icon="place" text={model.campusName} type="caption" color={theme.inkSecondary} /> : null}
          </View>
        </View>
        <IconButton icon="more" label="More" onPress={() => setSheet('menu')} />
      </View>

      <View style={styles.fill}>
        {body}
        {model.isLoading && model.events.length === 0 && !model.errorText ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="none"><Spinner /></View>
        ) : null}
      </View>

      {/* Disabled at each end of the year rather than silently doing nothing. */}
      <View style={[styles.weekBar, { borderTopColor: theme.separator }]}>
        <IconButton icon="back" label="Previous week" disabled={!model.canStep(-1)} onPress={() => model.stepIndex(-1)} />
        <IconButton icon="forward" label="Next week" disabled={!model.canStep(1)} onPress={() => model.stepIndex(1)} />
      </View>

      <ActionSheet visible={sheet === 'menu'} onClose={() => setSheet(null)} actions={menu} />
      {shell && !shell.groupsAssigned ? (
        <GroupsSheet visible={sheet === 'groups'} onClose={() => setSheet(null)} programme={shell.programme} source={shell.source} />
      ) : null}
      <LabsSheet visible={sheet === 'labs'} onClose={() => setSheet(null)} />
      <AccountSheet visible={sheet === 'account'} onClose={() => setSheet(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Space.xs, paddingBottom: Space.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  titleBlock: { flex: 1, alignItems: 'center' },
  subtitle: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  weekBar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: Space.s, borderTopWidth: StyleSheet.hairlineWidth },
});
