import { Tabs } from 'expo-router';
import { ComponentProps, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, LayoutChangeEvent, PanResponder, Platform, Pressable, StyleSheet, View, ViewStyle } from 'react-native';
import { Txt } from '../../ui/components';
import { useTutorialTarget } from '../tutorial/Tutorial';
import { FloatingBar, floatingBarMargin } from '../../ui/floatingBar';
import { concentric, Desktop, MIN_TARGET, Radius, Space, useTheme, withAlpha } from '../../ui/theme';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

/**
 * The tabs as a slider: an accent fill sits behind the selected tab and slides to the
 * other when it's tapped — or follows the finger when the slider is dragged, landing on
 * whichever tab it's released nearer.
 */
export function TabBar({ state, descriptors, navigation, insets }: TabBarProps) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  // A tab hidden with `href: null` (the Week tab on the Mac, where Day is the week) isn't drawn,
  // and the slider counts only the ones that are.
  const shown = state.routes.map((_, i) => i).filter((i) => (descriptors[state.routes[i].key].options as { href?: unknown }).href !== null);
  const count = shown.length;
  const position = Math.max(shown.indexOf(state.index), 0);
  const tabWidth = count > 0 ? width / count : 0;
  const [offset] = useState(() => new Animated.Value(0));
  /** The tab under the outline mid-drag, so the colours follow the finger. */
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
    Animated.timing(offset, { toValue: target, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
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
  const weekTab = useTutorialTarget('weekTab');
  const accountTab = useTutorialTarget('accountTab');
  const tutorialRefs: Record<string, typeof deadlinesTab> = { deadlines: deadlinesTab, week: weekTab, account: accountTab };
  const selected = hovered ?? position;
  // The pill is a capsule, and the outline inside it curves round the same centre, one
  // padding in from its edge — a capsule again, as far as the outline's own height allows.
  const outlineRadius = Math.min(concentric(FloatingBar.height / 2, FloatingBar.padding), height / 2 || Radius.control);
  // Filled like the app's other selected chips, so the tab under it takes their text colour.
  const selectedInk = theme.onAccent;

  return (
    // Laid over the screens, not under them: the lists pad their ends by `useTabBarClearance`.
    // `box-none` keeps the strip either side of the pill from swallowing touches meant for them.
    <View style={[styles.bar, { paddingBottom: floatingBarMargin(insets.bottom) }]} pointerEvents="box-none">
      <Haze />
      <View style={[styles.pill, glass(theme.scheme, theme.surface, theme.separator)]}>
      <View
        style={styles.slider}
        onLayout={(e: LayoutChangeEvent) => {
          setWidth(e.nativeEvent.layout.width);
          setHeight(e.nativeEvent.layout.height);
        }}
        accessibilityRole="tablist"
        {...responder.panHandlers}
      >
        {tabWidth > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[styles.outline, { width: tabWidth, borderRadius: outlineRadius, backgroundColor: theme.accent, transform: [{ translateX: offset }] }]}
          />
        ) : null}
        {shown.map((routeIndex, i) => {
          const route = state.routes[routeIndex];
          const { options } = descriptors[route.key];
          const isSelected = selected === i;
          const color = isSelected ? selectedInk : theme.inkSecondary;
          const title = options.title ?? route.name;
          // The account tab is only its icon, as the Notra tab bar's are: a person says "account".
          const iconOnly = options.tabBarShowLabel === false;
          return (
            <Pressable
              key={route.key}
              ref={tutorialRefs[route.name]}
              onPress={() => go(i)}
              accessibilityRole="tab"
              accessibilityLabel={title}
              accessibilityState={{ selected: position === i }}
              style={({ pressed }) => [styles.tab, { opacity: pressed ? 0.6 : 1 }]}
            >
              {options.tabBarIcon?.({ focused: isSelected, color, size: iconOnly ? 24 : 20 })}
              {iconOnly ? null : <Txt type="caption2" color={color} style={isSelected ? styles.semibold : undefined}>{title}</Txt>}
            </Pressable>
          );
        })}
      </View>
      </View>
    </View>
  );
}

/**
 * The haze behind the bar: the screen's own colour fading up from the bottom edge, so a list
 * running under the pill dissolves into it rather than being cut off by it. React Native has
 * no gradient, so it is a stack of thin bands, each a little more opaque than the one above.
 */
function Haze() {
  const theme = useTheme();
  const bands = 14;
  return (
    <View pointerEvents="none" style={styles.haze}>
      {Array.from({ length: bands }, (_, i) => (
        <View key={i} style={{ flex: 1, backgroundColor: withAlpha(theme.canvas, Math.pow((i + 1) / bands, 1.6) * 0.95) }} />
      ))}
    </View>
  );
}

/**
 * Frosted glass, as the Figma design draws it: the surface colour only about a third opaque
 * (the glass supplies the body), whatever scrolls beneath blurred and a touch more saturated,
 * and a faint light along the top edge where the glass catches the light. The blur is the
 * browser's `backdrop-filter`; the native build has no blur module, so there it's the tint
 * alone — which is why it keeps a little more of it.
 */
function glass(scheme: 'light' | 'dark', surface: string, edge: string): ViewStyle {
  const web = Platform.OS === 'web';
  const filter = 'blur(16px) saturate(1.6)';
  const highlight = scheme === 'dark' ? 'rgba(255, 255, 255, 0.14)' : 'rgba(255, 255, 255, 0.6)';
  const style = {
    backgroundColor: withAlpha(surface, web ? (scheme === 'dark' ? 0.4 : 0.45) : 0.72),
    borderColor: withAlpha(edge, 0.9),
    ...(web ? { backdropFilter: filter, WebkitBackdropFilter: filter } : null),
    boxShadow: `inset 0 1px 0 ${highlight}, 0 8px 24px rgba(0, 0, 0, 0.14)`,
  };
  return style as unknown as ViewStyle;
}

const styles = StyleSheet.create({
  haze: { position: 'absolute', left: 0, right: 0, bottom: 0, height: FloatingBar.height + 64 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: Space.l, alignItems: 'center' },
  // Across a desktop window the two tabs would sit a screen apart; keep them together.
  pill: {
    width: '100%', maxWidth: Desktop.dialog, padding: FloatingBar.padding,
    borderRadius: FloatingBar.height / 2, borderWidth: StyleSheet.hairlineWidth,
  },
  slider: { flexDirection: 'row', width: '100%' },
  outline: { position: 'absolute', top: 0, bottom: 0, left: 0 },
  tab: { flex: 1, minHeight: MIN_TARGET, alignItems: 'center', justifyContent: 'center', paddingVertical: Space.xs, gap: Space.xxs },
  semibold: { fontWeight: '600' },
});
