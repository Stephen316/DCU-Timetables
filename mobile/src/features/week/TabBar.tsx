import { Tabs } from 'expo-router';
import { ComponentProps, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, LayoutChangeEvent, PanResponder, Platform, Pressable, StyleSheet, TextStyle, View, ViewStyle } from 'react-native';
import { useTutorialTarget } from '../tutorial/Tutorial';
import { Txt } from '../../ui/components';
import { DesktopRail, FloatingBar, floatingBarMargin, useDesktopRail } from '../../ui/floatingBar';
import { Desktop, elevation, Palette, Space, useTheme, withAlpha } from '../../ui/theme';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

/** The tabs along the bottom on a phone, or down the right edge of a desktop-wide window. */
export function TabBar(props: TabBarProps) {
  return useDesktopRail() ? <RailTabBar {...props} /> : <BottomTabBar {...props} />;
}

/** The tabs a bar draws: any hidden with `href: null` (the week tab on the Mac) are left off. */
function shownTabs({ state, descriptors }: TabBarProps): number[] {
  return state.routes.map((_, i) => i).filter((i) => (descriptors[state.routes[i].key].options as { href?: unknown }).href !== null);
}

/** The rail's tabs from the top: the account first, then the week, today, and the deadlines. */
const RAIL_ORDER = ['account', 'week', 'index', 'deadlines'];

/**
 * The tabs on a desktop window: the same pill as the phone's bar, stood on end and running
 * the height of the window's right edge, the tabs gathered at its top and the selected one on
 * its violet disc. Each tab is only an icon; resting the cursor on one brings up its name in a
 * small bubble to its left.
 */
function RailTabBar(props: TabBarProps) {
  const { state, descriptors, navigation } = props;
  const theme = useTheme();
  const rank = (i: number) => {
    const at = RAIL_ORDER.indexOf(state.routes[i].name);
    return at === -1 ? RAIL_ORDER.length : at;
  };
  const shown = shownTabs(props).sort((a, b) => rank(a) - rank(b));
  const position = Math.max(shown.indexOf(state.index), 0);
  const [offset] = useState(() => new Animated.Value(position * FloatingBar.halo));
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    Animated.timing(offset, { toValue: position * FloatingBar.halo, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [position, offset]);

  const deadlinesTab = useTutorialTarget('deadlinesTab');
  const weekTab = useTutorialTarget('weekTab');
  const accountTab = useTutorialTarget('accountTab');
  const tutorialRefs: Record<string, typeof deadlinesTab> = { deadlines: deadlinesTab, week: weekTab, account: accountTab };

  const go = (slot: number) => {
    const route = state.routes[shown[slot]];
    if (!route) return;
    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (shown[slot] !== state.index && !event.defaultPrevented) navigation.navigate(route.name, route.params);
  };

  return (
    <View style={styles.rail} pointerEvents="box-none">
      <View style={[styles.railPill, { backgroundColor: theme.surface }, elevation(theme, 'float')]} accessibilityRole="tablist">
        <Animated.View pointerEvents="none" style={[styles.railIndicator, { transform: [{ translateY: offset }] }]}>
          <View style={[styles.halo, { backgroundColor: haloColor(theme) }]}>
            <View style={[styles.disc, { backgroundColor: theme.accent }]} />
          </View>
        </Animated.View>
        {shown.map((routeIndex, i) => {
          const route = state.routes[routeIndex];
          const { options } = descriptors[route.key];
          const isSelected = position === i;
          const name = options.title ?? route.name;
          const isHovered = hovered === i;
          return (
            <Pressable
              key={route.key}
              ref={tutorialRefs[route.name]}
              onPress={() => go(i)}
              onHoverIn={() => setHovered(i)}
              onHoverOut={() => setHovered((h) => (h === i ? null : h))}
              accessibilityRole="tab"
              accessibilityLabel={name}
              accessibilityState={{ selected: isSelected }}
              style={({ pressed }) => [styles.railTab, { opacity: pressed && !isSelected ? 0.5 : 1 }]}
            >
              {!isSelected && isHovered ? <View pointerEvents="none" style={[styles.railHover, { backgroundColor: haloColor(theme) }]} /> : null}
              {options.tabBarIcon?.({
                focused: isSelected,
                color: isSelected ? theme.onAccent : isHovered ? theme.accent : theme.inkTertiary,
                size: isSelected ? 22 : 24,
              })}
              {isHovered ? <RailTooltip name={name} /> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** A tab's name in a small bubble to its left, fading in as the cursor arrives. */
function RailTooltip({ name }: { name: string }) {
  const theme = useTheme();
  const [shown] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(shown, { toValue: 1, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [shown]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.tooltip,
        { backgroundColor: theme.surface, opacity: shown, transform: [{ translateX: shown.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] },
        elevation(theme, 'float'),
      ]}
    >
      <Txt type="subheadline" numberOfLines={1} style={styles.tooltipText}>{name}</Txt>
    </Animated.View>
  );
}

/**
 * The tabs as a row of icons on a plain white pill, as the design draws them: no words under
 * any of them, and the selected one sitting on a violet disc ringed by a pale violet halo. The
 * disc slides to a tab when it's tapped, or follows the finger when the row is dragged,
 * landing on whichever tab it's released nearer. The pill casts no shadow; it stands off the
 * screen by being white on the grey, and behind it the screen fades into the haze.
 */
function BottomTabBar(props: TabBarProps) {
  const { state, descriptors, navigation, insets } = props;
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  // A tab hidden with `href: null` (the Week tab on the Mac, where Day is the week) isn't drawn,
  // and the slider counts only the ones that are.
  const shown = shownTabs(props);
  const count = shown.length;
  const position = Math.max(shown.indexOf(state.index), 0);
  const tabWidth = count > 0 ? width / count : 0;
  const [offset] = useState(() => new Animated.Value(0));
  /** The tab under the disc mid-drag, so the colours follow the finger. */
  const [hovered, setHovered] = useState<number | null>(null);
  const lastWidth = useRef(0);

  const go = (slot: number) => {
    const route = state.routes[shown[slot]];
    if (!route) return;
    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (shown[slot] !== state.index && !event.defaultPrevented) navigation.navigate(route.name, route.params);
  };

  /** The latest values, for the gesture handlers, which outlive a render. */
  const live = useRef({ tabWidth, count, index: position, go });
  useLayoutEffect(() => {
    live.current = { tabWidth, count, index: position, go };
  });

  // A new width is a layout, not a move: jump there. A new tab slides.
  useEffect(() => {
    const target = position * tabWidth;
    if (lastWidth.current !== tabWidth) {
      lastWidth.current = tabWidth;
      offset.setValue(target);
      return;
    }
    Animated.timing(offset, { toValue: target, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [position, tabWidth, offset]);

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
        Animated.timing(offset, { toValue: index * w, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      },
      onPanResponderTerminate: () => {
        const { index, tabWidth: w } = live.current;
        setHovered(null);
        Animated.timing(offset, { toValue: index * w, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      },
      onPanResponderTerminationRequest: () => false,
    });
  }, [offset]);

  const deadlinesTab = useTutorialTarget('deadlinesTab');
  const weekTab = useTutorialTarget('weekTab');
  const accountTab = useTutorialTarget('accountTab');
  const tutorialRefs: Record<string, typeof deadlinesTab> = { deadlines: deadlinesTab, week: weekTab, account: accountTab };
  const selected = hovered ?? position;
  const margin = floatingBarMargin(insets.bottom);

  return (
    // Laid over the screens, not under them: the lists pad their ends by `useTabBarClearance`.
    // `box-none` keeps the strip either side of the pill from swallowing touches meant for them.
    <View style={[styles.bar, { paddingBottom: margin }]} pointerEvents="box-none">
      <Haze height={FloatingBar.fade + FloatingBar.height + margin} />
      <View
        style={[
          styles.pill,
          { backgroundColor: theme.surface },
          // White on the light grey needs nothing more; in the dark, a hairline keeps its edge.
          theme.scheme === 'dark' ? { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.separator } : null,
        ]}
      >
        <View style={styles.slider} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} accessibilityRole="tablist" {...responder.panHandlers}>
          {tabWidth > 0 ? (
            <Animated.View pointerEvents="none" style={[styles.indicator, { width: tabWidth, transform: [{ translateX: offset }] }]}>
              <View style={[styles.halo, { backgroundColor: haloColor(theme) }]}>
                <View style={[styles.disc, { backgroundColor: theme.accent }]} />
              </View>
            </Animated.View>
          ) : null}
          {shown.map((routeIndex, i) => {
            const route = state.routes[routeIndex];
            const { options } = descriptors[route.key];
            const isSelected = selected === i;
            return (
              <Pressable
                key={route.key}
                ref={tutorialRefs[route.name]}
                onPress={() => go(i)}
                accessibilityRole="tab"
                accessibilityLabel={options.title ?? route.name}
                accessibilityState={{ selected: position === i }}
                style={({ pressed }) => [styles.tab, { opacity: pressed && !isSelected ? 0.5 : 1 }]}
              >
                {options.tabBarIcon?.({ focused: isSelected, color: isSelected ? theme.onAccent : theme.inkTertiary, size: isSelected ? 22 : 24 })}
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

/** The ring round the selected tab's disc: the violet, faint on white and a touch stronger on the dark. */
function haloColor(theme: Palette): string {
  return withAlpha(theme.accent, theme.scheme === 'dark' ? 0.22 : 0.12);
}

/**
 * How opaque the haze is a fraction `t` of the way down its fade. Eased so it leaves clear
 * and arrives solid without a kink at either end: a fade that starts or stops on a slope
 * shows a line there, however soft the rest of it is.
 */
function hazeAt(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** The fade as gradient stops, close enough together that the curve between them doesn't show. */
function hazeStops(color: (alpha: number) => string, reach: number): string {
  const steps = 16;
  return Array.from({ length: steps + 1 }, (_, i) => `${color(hazeAt(i / steps))} ${((i / steps) * reach).toFixed(1)}px`).join(', ');
}

/**
 * The haze behind the bar: the screen fades into its own background colour over the last
 * stretch above the pill, so a list running under the bar dissolves rather than being cut
 * off, and the pill sits on plain background, as in the design. In the browser what fades is
 * also blurred, a little more the further down it goes, the way an iPhone frosts what passes
 * under its bars. React Native has no gradient, so on a phone the fade is a stack of thin
 * bands, too fine to see as steps.
 */
function Haze({ height }: { height: number }) {
  const theme = useTheme();
  const c = theme.canvas;
  const reach = FloatingBar.fade;
  if (Platform.OS === 'web') {
    const fade = `linear-gradient(to bottom, ${hazeStops((a) => withAlpha(c, a), reach)}, ${c} 100%)`;
    const mask = `linear-gradient(to bottom, ${hazeStops((a) => `rgba(0, 0, 0, ${a.toFixed(3)})`, reach)}, #000 100%)`;
    return (
      <View pointerEvents="none" style={[styles.haze, { height }]}>
        <View style={[StyleSheet.absoluteFill, { backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', maskImage: mask, WebkitMaskImage: mask } as ViewStyle]} />
        <View style={[StyleSheet.absoluteFill, { backgroundImage: fade } as ViewStyle]} />
      </View>
    );
  }
  const bands = 32;
  return (
    <View pointerEvents="none" style={[styles.haze, { height }]}>
      <View style={{ height: reach }}>
        {Array.from({ length: bands }, (_, i) => (
          <View key={i} style={{ flex: 1, backgroundColor: withAlpha(c, hazeAt((i + 0.5) / bands)) }} />
        ))}
      </View>
      <View style={{ flex: 1, backgroundColor: c }} />
    </View>
  );
}

const styles = StyleSheet.create({
  haze: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: Space.xl, alignItems: 'center' },
  // Across a desktop window the tabs would sit a screen apart; keep them together.
  pill: { width: '100%', maxWidth: Desktop.dialog, padding: FloatingBar.padding, borderRadius: FloatingBar.height / 2 },
  slider: { flexDirection: 'row', width: '100%' },
  indicator: { position: 'absolute', top: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  halo: { width: FloatingBar.halo, height: FloatingBar.halo, borderRadius: FloatingBar.halo / 2, alignItems: 'center', justifyContent: 'center' },
  disc: { width: FloatingBar.disc, height: FloatingBar.disc, borderRadius: FloatingBar.disc / 2 },
  tab: { flex: 1, height: FloatingBar.halo, alignItems: 'center', justifyContent: 'center' },
  // Down the right edge, centred top to bottom, clear of the screens beside it.
  // Down the right edge, from just under the top of the window to just above its foot.
  rail: { position: 'absolute', top: DesktopRail.margin, bottom: DesktopRail.margin, right: DesktopRail.margin, zIndex: 10 },
  railPill: { flex: 1, width: DesktopRail.pill, padding: FloatingBar.padding, borderRadius: DesktopRail.pill / 2, justifyContent: 'flex-start' },
  railIndicator: { position: 'absolute', top: FloatingBar.padding, left: FloatingBar.padding },
  railTab: { width: FloatingBar.halo, height: FloatingBar.halo, alignItems: 'center', justifyContent: 'center' },
  railHover: { position: 'absolute', top: 0, left: 0, width: FloatingBar.halo, height: FloatingBar.halo, borderRadius: FloatingBar.halo / 2 },
  // To the tab's left, past the pill's edge and a little gap, centred on the icon.
  tooltip: {
    position: 'absolute',
    right: FloatingBar.halo + FloatingBar.padding + Space.s,
    paddingHorizontal: Space.m,
    paddingVertical: Space.xs + 2,
    borderRadius: 10,
  },
  tooltipText: { fontWeight: '600', whiteSpace: 'nowrap' } as TextStyle,
});
