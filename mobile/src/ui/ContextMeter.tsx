import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { RollingCounter } from './RollingCounter';
import { Txt, useReduceMotion } from './components';
import { Space, Type, useTheme } from './theme';

/**
 * A label, "n of total" and a bar that fills to match — after bencho.dev's "Context meter"
 * block, rebuilt for React Native. The count rolls and the bar eases to its new width.
 */
export function ContextMeter({
  label, value, total, color,
}: { label: string; value: number; total: number; color: string }) {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();
  const share = total > 0 ? Math.min(Math.max(value / total, 0), 1) : 0;
  const [fill] = useState(() => new Animated.Value(share));
  useEffect(() => {
    Animated.timing(fill, {
      toValue: share, duration: reduceMotion ? 0 : 420, easing: Easing.out(Easing.cubic), useNativeDriver: false,
    }).start();
  }, [fill, share, reduceMotion]);

  return (
    <View
      style={styles.root}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${label}: ${value} of ${total}`}
      accessibilityValue={{ min: 0, max: total, now: value }}
    >
      <View style={styles.line}>
        <Txt type="caption" color={theme.inkSecondary}>{label}</Txt>
        <View style={styles.figures}>
          <RollingCounter value={value} color={theme.ink} style={[Type.caption, styles.figure]} />
          <Txt type="caption" color={theme.inkSecondary}> of {total}</Txt>
        </View>
      </View>
      <View style={[styles.track, { backgroundColor: theme.raised }]}>
        <Animated.View
          style={[styles.fill, { backgroundColor: color, width: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: Space.xs, minWidth: 140 },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Space.m },
  figures: { flexDirection: 'row', alignItems: 'center' },
  figure: { fontWeight: '600', fontVariant: ['tabular-nums'] },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
});
