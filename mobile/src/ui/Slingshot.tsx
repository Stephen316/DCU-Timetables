import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, View } from 'react-native';
import { Icon, Txt, useReduceMotion } from './components';
import { Space, useTheme } from './theme';

/** How far the puck has to be pulled before letting go fires. */
const THRESHOLD = 56;
const MAX_PULL = 88;

/**
 * Pull the puck down and let go: past the threshold it fires `onRelease` and springs back,
 * short of it, it only springs back — after bencho.dev's "Slingshot" block, rebuilt for
 * React Native. The browser has no pull-to-refresh of its own inside the app, so on the web
 * build this is how a list is refreshed by hand. Works with a finger or a mouse.
 */
export function Slingshot({
  onRelease, busy, label = 'Pull to refresh',
}: { onRelease: () => void; busy?: boolean; label?: string }) {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();
  const [pull] = useState(() => new Animated.Value(0));
  const [armed, setArmed] = useState(false);
  // The responder is made once; these keep what it calls current.
  const live = useRef({ onRelease, reduceMotion });
  useEffect(() => {
    live.current = { onRelease, reduceMotion };
  }, [onRelease, reduceMotion]);

  // These handlers read the ref only from gesture events, never during a render.
  // eslint-disable-next-line react-hooks/refs
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 3,
    onPanResponderMove: (_, g) => {
      const dy = Math.min(Math.max(g.dy, 0), MAX_PULL);
      pull.setValue(dy);
      setArmed(dy >= THRESHOLD);
    },
    onPanResponderRelease: (_, g) => {
      setArmed(false);
      if (g.dy >= THRESHOLD) live.current.onRelease();
      Animated.spring(pull, { toValue: 0, bounciness: live.current.reduceMotion ? 0 : 14, useNativeDriver: false }).start();
    },
    onPanResponderTerminate: () => {
      setArmed(false);
      Animated.spring(pull, { toValue: 0, useNativeDriver: false }).start();
    },
  }), [pull]);

  return (
    <View style={styles.root}>
      <Animated.View
        {...responder.panHandlers}
        style={[
          styles.puck,
          { backgroundColor: armed ? theme.accent : theme.raised, borderColor: theme.separator, transform: [{ translateY: pull }] },
        ]}
        accessible
        accessibilityRole="button"
        accessibilityLabel="Refresh"
        accessibilityActions={[{ name: 'activate', label: 'Refresh' }]}
        onAccessibilityAction={() => live.current.onRelease()}
      >
        <Icon name="arrowDown" size={16} color={armed ? theme.onAccent : theme.inkSecondary} />
      </Animated.View>
      <Txt type="caption" color={theme.inkTertiary}>{busy ? 'Refreshing…' : armed ? 'Let go to refresh' : label}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: Space.xs, paddingBottom: Space.s },
  puck: { width: 36, height: 36, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
});
