import { Tabs } from 'expo-router';
import { ComponentProps, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, LayoutChangeEvent, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { Txt } from '../../ui/components';
import { MIN_TARGET, Radius, Space, useTheme } from '../../ui/theme';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

/**
 * The tabs as a slider: an accent outline sits around the selected tab and slides to the
 * other when it's tapped — or follows the finger when the slider is dragged, landing on
 * whichever tab it's released nearer.
 */
export function TabBar({ state, descriptors, navigation, insets }: TabBarProps) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const count = state.routes.length;
  const tabWidth = count > 0 ? width / count : 0;
  const [offset] = useState(() => new Animated.Value(0));
  /** The tab under the outline mid-drag, so the colours follow the finger. */
  const [hovered, setHovered] = useState<number | null>(null);
  const lastWidth = useRef(0);

  const go = (index: number) => {
    const route = state.routes[index];
    if (!route) return;
    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (index !== state.index && !event.defaultPrevented) navigation.navigate(route.name, route.params);
  };

  /** The latest values, for the gesture handlers, which outlive a render. */
  const live = useRef({ tabWidth, count, index: state.index, go });
  useLayoutEffect(() => {
    live.current = { tabWidth, count, index: state.index, go };
  });

  // A new width is a layout, not a move: jump there. A new tab slides.
  useEffect(() => {
    const target = state.index * tabWidth;
    if (lastWidth.current !== tabWidth) {
      lastWidth.current = tabWidth;
      offset.setValue(target);
      return;
    }
    Animated.timing(offset, { toValue: target, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [state.index, tabWidth, offset]);

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

  const selected = hovered ?? state.index;
  // White reads on the dark canvas; on Solarized Light's cream it would vanish, so ink.
  const selectedInk = theme.scheme === 'dark' ? '#FFFFFF' : theme.ink;

  return (
    <View style={[styles.bar, { backgroundColor: theme.canvas, paddingBottom: Math.max(insets.bottom, Space.s) }]}>
      <View
        style={styles.slider}
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        accessibilityRole="tablist"
        {...responder.panHandlers}
      >
        {tabWidth > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[styles.outline, { width: tabWidth, borderColor: theme.accent, transform: [{ translateX: offset }] }]}
          />
        ) : null}
        {state.routes.map((route, i) => {
          const { options } = descriptors[route.key];
          const isSelected = selected === i;
          const color = isSelected ? selectedInk : theme.inkSecondary;
          const title = options.title ?? route.name;
          return (
            <Pressable
              key={route.key}
              onPress={() => go(i)}
              accessibilityRole="tab"
              accessibilityLabel={title}
              accessibilityState={{ selected: state.index === i }}
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
  bar: { paddingHorizontal: Space.l, paddingTop: Space.xs },
  slider: { flexDirection: 'row' },
  outline: { position: 'absolute', top: 0, bottom: 0, left: 0, borderWidth: 1, borderRadius: Radius.control },
  tab: { flex: 1, minHeight: MIN_TARGET, alignItems: 'center', justifyContent: 'center', paddingVertical: Space.xs, gap: Space.xxs },
  semibold: { fontWeight: '600' },
});
