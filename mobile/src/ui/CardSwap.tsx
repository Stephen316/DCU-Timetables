import { ReactNode, useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleProp, ViewStyle } from 'react-native';
import { useReduceMotion } from './components';

/**
 * Content that swaps like a card dealt onto a stack: when `swapKey` changes, the new card
 * settles in from just below and slightly smaller, fading up — after bencho.dev's "Card swap"
 * block, rebuilt for React Native. The first render shows as it is, and Reduce Motion skips it.
 */
export function CardSwap({
  swapKey, children, style,
}: { swapKey: string | number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduceMotion = useReduceMotion();
  const [progress] = useState(() => new Animated.Value(1));
  const last = useRef(swapKey);
  useEffect(() => {
    if (last.current === swapKey) return;
    last.current = swapKey;
    if (reduceMotion) return;
    progress.setValue(0);
    Animated.timing(progress, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [swapKey, reduceMotion, progress]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
            { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.985, 1] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
