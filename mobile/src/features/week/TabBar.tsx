import { Tabs } from 'expo-router';
import { ComponentProps, createContext, ReactNode, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, LayoutChangeEvent, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { MacShell } from '../../data/macShell';
import { useRoot } from '../../state/root';
import { Icon, IconName, Txt, useWide } from '../../ui/components';
import { Desktop, MIN_TARGET, Radius, Space, useTheme } from '../../ui/theme';
import { AccountSheet } from '../account/AccountSheet';
import { NotificationsSheet } from '../alerts/NotificationsSheet';
import { useTutorialTarget } from '../tutorial/Tutorial';
import { ExportCalendarCard } from './ExportCalendarCard';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

/** Width reserved on the right side of the window for the vertical desktop navigation rail. */
export const DESKTOP_RAIL_WIDTH = 68;

interface TimetableEditState {
  editing: boolean;
  setEditing: (next: boolean) => void;
  desktopDayView: boolean;
  setDesktopDayView: (next: boolean) => void;
}

const TimetableEditContext = createContext<TimetableEditState>({
  editing: false,
  setEditing: () => undefined,
  desktopDayView: false,
  setDesktopDayView: () => undefined,
});

export function TimetableEditProvider({ children }: { children: ReactNode }) {
  const [editing, setEditing] = useState(false);
  const [desktopDayView, setDesktopDayView] = useState(false);
  const value = useMemo(
    () => ({ editing, setEditing, desktopDayView, setDesktopDayView }),
    [editing, desktopDayView],
  );
  return <TimetableEditContext.Provider value={value}>{children}</TimetableEditContext.Provider>;
}

export function useTimetableEdit(): TimetableEditState {
  return useContext(TimetableEditContext);
}

interface UtilityItem {
  key: string;
  label: string;
  icon: IconName;
  active?: boolean;
  onPress: () => void;
}

interface PrimaryNavItem {
  key: string;
  label: string;
  icon: IconName;
  selected: boolean;
  onPress: () => void;
}

/**
 * On mobile, the tabs sit at the bottom as a draggable slider.
 * On desktop, the right-hand vertical rail houses utility actions at the top and the primary
 * views below, using the app's standard `Radius.control` and palette tokens.
 */
export function TabBar({ state, descriptors, navigation, insets }: TabBarProps) {
  const theme = useTheme();
  const { signOut } = useRoot();
  const { editing, setEditing } = useTimetableEdit();
  const [inMacApp] = useState(() => MacShell.isPresent());
  const wide = useWide();
  const onDesktop = inMacApp || wide;
  const mobileRoutes = useMemo(
    () => state.routes.filter((r) => r.name !== 'journal'),
    [state.routes],
  );
  const [width, setWidth] = useState(0);
  const count = mobileRoutes.length;
  const tabWidth = count > 0 ? width / count : 0;
  const [offset] = useState(() => new Animated.Value(0));
  /** The tab under the outline mid-drag, so the colours follow the finger. */
  const [hovered, setHovered] = useState<number | null>(null);
  /** The item hovered by the mouse cursor in the desktop right-side column. */
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'account' | 'alerts' | 'export' | null>(null);
  const lastWidth = useRef(0);

  const goRoute = (route: (typeof state.routes)[number] | undefined) => {
    if (!route) return;
    const routeIndex = state.routes.findIndex((r) => r.key === route.key);
    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (routeIndex !== state.index && !event.defaultPrevented) navigation.navigate(route.name, route.params);
  };

  const go = (mobileIndex: number) => {
    goRoute(mobileRoutes[mobileIndex]);
  };

  const activeMobileIndex = Math.max(
    0,
    mobileRoutes.findIndex((r) => r.key === state.routes[state.index]?.key),
  );

  /** The latest values, for the gesture handlers, which outlive a render. */
  const live = useRef({ tabWidth, count, index: activeMobileIndex, go });
  useLayoutEffect(() => {
    live.current = { tabWidth, count, index: activeMobileIndex, go };
  });

  // A new width is a layout, not a move: jump there. A new tab slides.
  useEffect(() => {
    const target = activeMobileIndex * tabWidth;
    if (lastWidth.current !== tabWidth) {
      lastWidth.current = tabWidth;
      offset.setValue(target);
      return;
    }
    Animated.timing(offset, { toValue: target, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [activeMobileIndex, tabWidth, offset]);

  const responder = useMemo(() => {
    const position = (dx: number) => {
      const { tabWidth: w, count: n, index } = live.current;
      return Math.min(Math.max(index * w + dx, 0), (n - 1) * w);
    };
    const nearest = (dx: number) => {
      const w = live.current.tabWidth;
      return w > 0 ? Math.round(position(dx) / w) : live.current.index;
    };
    // These handlers read refs, but only ever from gesture events, never during a render.
    // eslint-disable-next-line react-hooks/refs
    return PanResponder.create({
      // Only a decisive sideways drag; a tap still reaches the tab underneath.
      onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_, g) => {
        offset.setValue(position(g.dx));
        setHovered(nearest(g.dx));
      },
      onPanResponderRelease: (_, g) => {
        const { index, tabWidth: w, go: select } = live.current;
        const destination = nearest(g.dx);
        setHovered(null);
        if (destination !== index) return select(destination);
        Animated.timing(offset, { toValue: index * w, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
      },
      onPanResponderTerminate: () => {
        const { index, tabWidth: w } = live.current;
        setHovered(null);
        Animated.timing(offset, { toValue: index * w, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
      },
      onPanResponderTerminationRequest: () => false,
    });
  }, [offset]);

  const deadlinesTab = useTutorialTarget('deadlinesTab');
  const selected = hovered ?? activeMobileIndex;
  // White reads on the dark canvas; on Solarized Light's cream it would vanish, so ink.
  const selectedInk = theme.scheme === 'dark' ? '#FFFFFF' : theme.ink;

  if (onDesktop) {
    const indexRoute = state.routes.find((r) => r.name === 'index');
    const journalRoute = state.routes.find((r) => r.name === 'journal');
    const currentRouteKey = state.routes[state.index]?.key;
    const onIndexTab = currentRouteKey === indexRoute?.key;

    const utilities: UtilityItem[] = [
      {
        key: 'util-edit',
        label: editing ? 'Done editing' : 'Edit timetable',
        icon: 'edit',
        active: editing,
        onPress: () => {
          if (!onIndexTab) goRoute(indexRoute);
          setEditing(!editing);
        },
      },
      { key: 'util-account', label: 'Account', icon: 'account', onPress: () => setSheet('account') },
      { key: 'util-alerts', label: 'Notifications', icon: 'bell', onPress: () => setSheet('alerts') },
      { key: 'util-export', label: 'Export to Calendar', icon: 'export', onPress: () => setSheet('export') },
      { key: 'util-signout', label: 'Sign out', icon: 'signOut', onPress: signOut },
    ];

    const primaryNav: PrimaryNavItem[] = [
      {
        key: 'nav-calendar',
        label: 'Calendar',
        icon: 'calendar',
        selected: onIndexTab,
        onPress: () => {
          if (!onIndexTab) goRoute(indexRoute);
        },
      },
      {
        key: 'nav-journal',
        label: 'Journal',
        icon: 'journal',
        selected: currentRouteKey === journalRoute?.key,
        onPress: () => {
          goRoute(journalRoute);
        },
      },
    ];

    return (
      <>
        <View
          style={[
            styles.railDesktop,
            { backgroundColor: theme.canvas, borderLeftColor: theme.separator },
          ]}
          accessibilityRole="tablist"
        >
          <View style={styles.utilityColumn}>
            {utilities.map((item) => {
              const isMouseHovered = hoveredKey === item.key;
              const isActive = Boolean(item.active);
              const color = isActive ? theme.accent : isMouseHovered ? selectedInk : theme.inkSecondary;
              return (
                <View key={item.key} style={styles.utilitySlot}>
                  <Pressable
                    onPress={item.onPress}
                    onHoverIn={() => setHoveredKey(item.key)}
                    onHoverOut={() => setHoveredKey((prev) => (prev === item.key ? null : prev))}
                    accessibilityRole="button"
                    accessibilityLabel={item.label}
                    style={({ pressed }) => [
                      styles.utilityBtn,
                      isMouseHovered ? styles.utilityBtnExpanded : styles.utilityBtnCollapsed,
                      {
                        backgroundColor: isMouseHovered
                          ? theme.raised
                          : isActive
                            ? theme.surface
                            : 'transparent',
                        borderColor: isActive
                          ? theme.accent
                          : isMouseHovered
                            ? theme.separator
                            : 'transparent',
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Icon name={item.icon} size={18} color={color} />
                    {isMouseHovered ? (
                      <Txt type="footnote" color={color} numberOfLines={1} style={styles.railLabel}>
                        {item.label}
                      </Txt>
                    ) : null}
                  </Pressable>
                </View>
              );
            })}
          </View>

          <View style={[styles.railDivider, { backgroundColor: theme.separator }]} />

          <View style={styles.railColumn}>
            {primaryNav.map((item) => {
              const isSelected = item.selected;
              const isMouseHovered = hoveredKey === item.key;
              const color = isSelected || isMouseHovered ? selectedInk : theme.inkSecondary;
              return (
                <View key={item.key} style={styles.railSlot}>
                  <Pressable
                    onPress={item.onPress}
                    onHoverIn={() => setHoveredKey(item.key)}
                    onHoverOut={() => setHoveredKey((prev) => (prev === item.key ? null : prev))}
                    accessibilityRole="tab"
                    accessibilityLabel={item.label}
                    accessibilityState={{ selected: isSelected }}
                    style={({ pressed }) => [
                      styles.railBtn,
                      isMouseHovered ? styles.railBtnExpanded : styles.railBtnCollapsed,
                      {
                        backgroundColor: isMouseHovered
                          ? theme.raised
                          : isSelected
                            ? theme.surface
                            : theme.canvas,
                        borderColor: isSelected ? theme.accent : theme.separator,
                        opacity: pressed ? 0.75 : 1,
                      },
                    ]}
                  >
                    <Icon name={item.icon} size={20} color={color} />
                    {isMouseHovered ? (
                      <Txt type="subheadline" color={color} numberOfLines={1} style={styles.railLabel}>
                        {item.label}
                      </Txt>
                    ) : null}
                  </Pressable>
                </View>
              );
            })}
          </View>
        </View>
        <AccountSheet visible={sheet === 'account'} onClose={() => setSheet(null)} />
        <NotificationsSheet visible={sheet === 'alerts'} onClose={() => setSheet(null)} />
        <ExportCalendarCard visible={sheet === 'export'} onClose={() => setSheet(null)} />
      </>
    );
  }

  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: theme.canvas, borderTopColor: theme.separator, paddingBottom: Math.max(insets.bottom, Space.s) },
      ]}
    >
      <View
        style={styles.slider}
        onLayout={(e: LayoutChangeEvent) => {
          setWidth(e.nativeEvent.layout.width);
        }}
        accessibilityRole="tablist"
        {...responder.panHandlers}
      >
        {tabWidth > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[styles.outline, { width: tabWidth, borderRadius: Radius.control, borderColor: theme.accent, transform: [{ translateX: offset }] }]}
          />
        ) : null}
        {mobileRoutes.map((route, i) => {
          const { options } = descriptors[route.key];
          const isSelected = selected === i;
          const color = isSelected ? selectedInk : theme.inkSecondary;
          const title = options.title ?? route.name;
          return (
            <Pressable
              key={route.key}
              ref={route.name === 'deadlines' ? deadlinesTab : undefined}
              onPress={() => go(i)}
              accessibilityRole="tab"
              accessibilityLabel={title}
              accessibilityState={{ selected: activeMobileIndex === i }}
              style={({ pressed }) => [styles.tab, { opacity: pressed ? 0.6 : 1 }]}
            >
              {options.tabBarIcon?.({ focused: isSelected, color, size: 20 })}
              <Txt type="caption2" color={color} style={isSelected ? styles.semibold : undefined}>{title}</Txt>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: Space.l, paddingTop: Space.xs, borderTopWidth: StyleSheet.hairlineWidth },
  slider: { flexDirection: 'row', width: '100%', maxWidth: Desktop.dialog, alignSelf: 'center' },
  outline: { position: 'absolute', top: 0, bottom: 0, left: 0, borderWidth: 1 },
  tab: { flex: 1, minHeight: MIN_TARGET, alignItems: 'center', justifyContent: 'center', paddingVertical: Space.xs, gap: Space.xxs },
  semibold: { fontWeight: '600' },
  railDesktop: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: DESKTOP_RAIL_WIDTH,
    borderLeftWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: Space.m,
    paddingBottom: Space.l,
    zIndex: 50,
  },
  utilityColumn: {
    flexDirection: 'column',
    gap: Space.xs,
    alignItems: 'center',
  },
  utilitySlot: {
    width: 38,
    height: 38,
  },
  utilityBtn: {
    position: 'absolute',
    right: 0,
    top: 0,
    height: 38,
    borderRadius: Radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
  },
  utilityBtnCollapsed: {
    width: 38,
    justifyContent: 'center',
  },
  utilityBtnExpanded: {
    paddingHorizontal: Space.m,
    gap: Space.xs,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  railDivider: {
    width: 36,
    height: StyleSheet.hairlineWidth,
    marginVertical: Space.m,
  },
  railColumn: {
    flexDirection: 'column',
    gap: Space.s,
    alignItems: 'center',
  },
  railSlot: {
    width: 44,
    height: 44,
  },
  railBtn: {
    position: 'absolute',
    right: 0,
    top: 0,
    height: 44,
    borderRadius: Radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
  },
  railBtnCollapsed: {
    width: 44,
    justifyContent: 'center',
  },
  railBtnExpanded: {
    paddingHorizontal: Space.m,
    gap: Space.s,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  railLabel: {
    fontWeight: '600',
  },
});
