import { useEffect, useState } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { Txt, useReduceMotion } from './components';
import { useTheme } from './theme';

const WIDTH = 14;
/** Densest at the head, fading out behind it. */
const TRAIL = '@%#*+=-:. ';

/**
 * A bit of ASCII that sails back and forth, leaving a fading wake — after bencho.dev's
 * "ASCII wake" block, rebuilt for React Native; the loading indicator on the web build.
 * Reduce Motion freezes it mid-trail. Monospaced so the columns don't shift.
 */
export function AsciiWake() {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (reduceMotion) return;
    const timer = setInterval(() => setTick((t) => t + 1), 90);
    return () => clearInterval(timer);
  }, [reduceMotion]);

  // Bounce across 0…WIDTH-1 and back.
  const span = WIDTH - 1;
  const phase = tick % (span * 2);
  const head = phase <= span ? phase : span * 2 - phase;
  const direction = phase < span ? 1 : -1;
  const line = Array.from({ length: WIDTH }, (_, i) => {
    const behind = (head - i) * direction;
    return behind >= 0 && behind < TRAIL.length ? TRAIL[behind] : ' ';
  }).join('');

  return (
    <Txt type="subheadline" color={theme.inkSecondary} style={styles.line} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {line}
    </Txt>
  );
}

const styles = StyleSheet.create({
  line: { fontFamily: Platform.select({ web: 'ui-monospace, SFMono-Regular, Menlo, monospace', ios: 'Menlo', default: 'monospace' }) },
});
