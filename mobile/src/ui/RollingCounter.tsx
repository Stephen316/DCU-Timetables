import { useEffect, useState } from 'react';
import { Animated, Easing, StyleProp, StyleSheet, Text, TextStyle, View } from 'react-native';
import { useReduceMotion } from './components';

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * A number whose digits roll to their new value, after bencho.dev's "Rolling counter" block
 * (rebuilt for React Native; nothing is copied from the site). Each digit is a column of 0–9
 * behind a window one line tall, and a change slides the column.
 *
 * Digits are keyed from the right, so 9 → 10 grows a new leading column while the units
 * column rolls, as an odometer does. Reduce Motion snaps instead of rolling, and a screen
 * reader hears the number once rather than ten digits per column.
 */
export function RollingCounter({
  value, style, color, accessibilityLabel,
}: { value: number; style?: StyleProp<TextStyle>; color: string; accessibilityLabel?: string }) {
  const flat = StyleSheet.flatten(style) ?? {};
  const fontSize = flat.fontSize ?? 15;
  const lineHeight = Math.round(fontSize * 1.3);
  const digits = String(Math.max(0, Math.trunc(value))).split('').map(Number);

  return (
    <View
      style={styles.row}
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel ?? String(value)}
    >
      {digits.map((digit, i) => (
        <Column key={digits.length - i} digit={digit} height={lineHeight} style={[style, { lineHeight, color }]} />
      ))}
    </View>
  );
}

function Column({ digit, height, style }: { digit: number; height: number; style: StyleProp<TextStyle> }) {
  const reduceMotion = useReduceMotion();
  const [offset] = useState(() => new Animated.Value(-digit * height));
  useEffect(() => {
    const target = -digit * height;
    if (reduceMotion) {
      offset.setValue(target);
      return;
    }
    Animated.timing(offset, { toValue: target, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [digit, height, offset, reduceMotion]);

  return (
    <View style={{ height, overflow: 'hidden' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={{ transform: [{ translateY: offset }] }}>
        {DIGITS.map((d) => (
          <Text key={d} style={[style, { height }]}>{d}</Text>
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
});
