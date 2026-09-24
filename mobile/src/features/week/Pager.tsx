import { createContext, ReactNode, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, LayoutChangeEvent, PanResponder, StyleSheet, View } from 'react-native';
import { PagerBounds, PagerDragState, PagerIndex } from '../../core/misc';

/**
 * The enclosing pager's drag state. Defaults to one that never suppresses anything, so a
 * row used outside a pager behaves normally.
 */
const PagerDragContext = createContext(new PagerDragState());

export function usePagerDrag(): PagerDragState {
  return useContext(PagerDragContext);
}

const COMMIT_FRACTION = 0.22;

/**
 * A horizontally paged container whose content **tracks the finger**. Three pages are kept
 * live — previous, current, next — offset by the drag, so a partial swipe shows the
 * neighbour and can be abandoned. On release the offset animates to the page edge and the
 * index is committed, which is what makes wrapping (Fri → Mon) possible.
 *
 * `bounds` decides the ends: the day pager wraps within its week; the week pager stops,
 * because scrolling back from week 1 and landing in week 52 is a teleport, not a scroll.
 */
export function Pager({
  count, index, onIndexChange, bounds = 'wrapping', renderPage,
}: {
  count: number;
  index: number;
  onIndexChange: (index: number) => void;
  bounds?: PagerBounds;
  renderPage: (index: number) => ReactNode;
}) {
  const [width, setWidth] = useState(0);
  const [drag] = useState(() => new Animated.Value(0));
  const [dragState] = useState(() => new PagerDragState());
  /** The latest props, for the gesture handlers, which outlive a render. */
  const live = useRef({ index, count, bounds, width, onIndexChange });
  const committing = useRef(false);

  useLayoutEffect(() => {
    live.current = { index, count, bounds, width, onIndexChange };
  });

  // The new centre page is already rendered by the time this runs, so resetting the offset
  // here — before paint — swaps pages with no visible jump.
  useLayoutEffect(() => {
    drag.setValue(0);
    committing.current = false;
  }, [index, drag]);

  const responder = useMemo(() => {
    const isBlocked = (dx: number) => {
      const { index: i, count: n, bounds: b } = live.current;
      return PagerIndex.resolve(dx > 0 ? i - 1 : i + 1, n, b) === null;
    };
    const settle = () => {
      Animated.timing(drag, { toValue: 0, duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
    };
    const finish = (dx: number, dy: number) => {
      dragState.end();
      const { index: i, count: n, bounds: b, width: w } = live.current;
      if (Math.abs(dx) <= Math.abs(dy) || w === 0) return settle();
      const step = dx < -w * COMMIT_FRACTION ? 1 : dx > w * COMMIT_FRACTION ? -1 : 0;
      const destination = step === 0 ? null : PagerIndex.resolve(i + step, n, b);
      if (destination === null) return settle();
      committing.current = true;
      Animated.timing(drag, { toValue: step > 0 ? -w : w, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: false })
        .start(() => live.current.onIndexChange(destination));
    };
    // These handlers read refs, but only ever from gesture events, never during a render;
    // the rule can't see that through PanResponder.
    // eslint-disable-next-line react-hooks/refs
    return PanResponder.create({
      // Only decisively horizontal drags, so each page's own vertical scrolling still works.
      // The capture phase takes it from the rows, so a swipe that starts on one isn't a tap.
      onMoveShouldSetPanResponderCapture: (_, g) =>
        !committing.current && Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderGrant: () => dragState.begin(),
      onPanResponderMove: (_, g) => {
        // Past the last page the content resists rather than freezing, so the gesture
        // reads as "there is nothing here", not as a dropped touch.
        drag.setValue(isBlocked(g.dx) ? g.dx * 0.25 : g.dx);
      },
      onPanResponderRelease: (_, g) => finish(g.dx, g.dy),
      onPanResponderTerminate: () => {
        dragState.end();
        settle();
      },
      onPanResponderTerminationRequest: () => false,
    });
  }, [drag, dragState]);

  const page = (value: number) => {
    // Blank rather than the far end of the range — the whole point of `clamped`.
    const resolved = PagerIndex.resolve(value, count, bounds);
    return resolved === null ? null : renderPage(resolved);
  };

  return (
    <View style={styles.clip} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} {...responder.panHandlers}>
      {width > 0 ? (
        <PagerDragContext.Provider value={dragState}>
          <Animated.View
            style={[styles.strip, { width: width * 3, transform: [{ translateX: Animated.add(drag, -width) }] }]}
          >
            <View style={{ width }} key={`p${index - 1}`} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>{page(index - 1)}</View>
            <View style={{ width }} key={`p${index}`}>{page(index)}</View>
            <View style={{ width }} key={`p${index + 1}`} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>{page(index + 1)}</View>
          </Animated.View>
        </PagerDragContext.Provider>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { flex: 1, overflow: 'hidden' },
  strip: { flex: 1, flexDirection: 'row' },
});
