import { createContext, ReactNode, RefObject, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, LayoutChangeEvent, PanResponder, Platform, StyleSheet, View } from 'react-native';
import { PagerDragState, PagerIndex } from '../../core/misc';

/**
 * The enclosing pager's drag state. Defaults to one that never suppresses anything, so a
 * row used outside a pager behaves normally.
 */
const PagerDragContext = createContext(new PagerDragState());

export function usePagerDrag(): PagerDragState {
  return useContext(PagerDragContext);
}

/**
 * How far a drag has to go before it turns the page, and how far a finger moves before
 * the pager takes it from the rows. `easy` also turns on a quick flick, however short.
 */
const SWIPE = {
  standard: { commitFraction: 0.22, startDistance: 12, flickVelocity: Infinity },
  easy: { commitFraction: 0.12, startDistance: 8, flickVelocity: 0.35 },
} as const;

/** A flick shorter than this is a wobble, not a swipe. */
const MIN_FLICK_DISTANCE = 20;

/**
 * A two-finger trackpad swipe: how far it scrolls sideways before it turns the page, and the
 * pause that ends it. The pause has to outlast the momentum the Mac adds after the fingers
 * lift, or one swipe would turn several pages.
 */
const TRACKPAD = { distance: 50, settleMs: 200 } as const;

/** Turns the page from outside — the back and forward buttons beside a title. */
export interface PagerControl {
  turn(step: 1 | -1): void;
}

/**
 * A horizontally paged container whose content **tracks the finger**. Three pages are kept
 * live — previous, current, next — offset by the drag, so a partial swipe shows the
 * neighbour and can be abandoned. On release the offset animates to the page edge and the
 * index is committed. It stops at both ends (`PagerIndex`).
 */
export function Pager({
  count, index, onIndexChange, swipe = 'standard', renderPage, controlRef,
}: {
  count: number;
  index: number;
  onIndexChange: (index: number) => void;
  swipe?: keyof typeof SWIPE;
  renderPage: (index: number) => ReactNode;
  controlRef?: RefObject<PagerControl | null>;
}) {
  const [width, setWidth] = useState(0);
  const [drag] = useState(() => new Animated.Value(0));
  const [dragState] = useState(() => new PagerDragState());
  /** The latest props, for the gesture handlers, which outlive a render. */
  const live = useRef({ index, count, width, onIndexChange, swipe });
  const committing = useRef(false);
  const clip = useRef<View>(null);

  useLayoutEffect(() => {
    live.current = { index, count, width, onIndexChange, swipe };
  });

  // The new centre page is already rendered by the time this runs, so resetting the offset
  // here — before paint — swaps pages with no visible jump.
  useLayoutEffect(() => {
    drag.setValue(0);
    committing.current = false;
  }, [index, drag]);

  const { responder, turn } = useMemo(() => {
    const isBlocked = (dx: number) => {
      const { index: i, count: n } = live.current;
      return PagerIndex.resolve(dx > 0 ? i - 1 : i + 1, n) === null;
    };
    const settle = () => {
      Animated.timing(drag, { toValue: 0, duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
    };
    /** Slides on to the next page (1) or back (-1), from wherever a drag left it. */
    const turn = (step: 1 | -1) => {
      const { index: i, count: n, width: w } = live.current;
      const destination = PagerIndex.resolve(i + step, n);
      if (destination === null || w === 0) return settle();
      if (committing.current) return;
      committing.current = true;
      Animated.timing(drag, { toValue: step > 0 ? -w : w, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: false })
        .start(() => live.current.onIndexChange(destination));
    };
    const finish = (dx: number, dy: number, vx: number) => {
      dragState.end();
      const { width: w, swipe: kind } = live.current;
      if (Math.abs(dx) <= Math.abs(dy) || w === 0) return settle();
      const { commitFraction, flickVelocity } = SWIPE[kind];
      const flicked = Math.abs(vx) >= flickVelocity && Math.abs(dx) >= MIN_FLICK_DISTANCE && Math.sign(vx) === Math.sign(dx);
      const far = Math.abs(dx) > w * commitFraction;
      if (!far && !flicked) return settle();
      turn(dx < 0 ? 1 : -1);
    };
    // These handlers read refs, but only ever from gesture events, never during a render;
    // the rule can't see that through PanResponder.
    // eslint-disable-next-line react-hooks/refs
    const responder = PanResponder.create({
      // Only decisively horizontal drags, so each page's own vertical scrolling still works.
      // The capture phase takes it from the rows, so a swipe that starts on one isn't a tap.
      onMoveShouldSetPanResponderCapture: (_, g) =>
        !committing.current && Math.abs(g.dx) > SWIPE[live.current.swipe].startDistance && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderGrant: () => dragState.begin(),
      onPanResponderMove: (_, g) => {
        // Past the last page the content resists rather than freezing, so the gesture
        // reads as "there is nothing here", not as a dropped touch.
        drag.setValue(isBlocked(g.dx) ? g.dx * 0.25 : g.dx);
      },
      onPanResponderRelease: (_, g) => finish(g.dx, g.dy, g.vx),
      onPanResponderTerminate: () => {
        dragState.end();
        settle();
      },
      onPanResponderTerminationRequest: () => false,
    });
    return { responder, turn };
  }, [drag, dragState]);

  useImperativeControl(controlRef, turn);
  useDesktopTurns(clip, turn);

  const page = (value: number) => {
    // Blank rather than the far end of the range — the whole point of `clamped`.
    const resolved = PagerIndex.resolve(value, count);
    return resolved === null ? null : renderPage(resolved);
  };

  return (
    <View ref={clip} style={styles.clip} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} {...responder.panHandlers}>
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

function useImperativeControl(controlRef: RefObject<PagerControl | null> | undefined, turn: PagerControl['turn']) {
  useEffect(() => {
    if (!controlRef) return;
    controlRef.current = { turn };
    return () => {
      controlRef.current = null;
    };
  }, [controlRef, turn]);
}

/**
 * With no finger to swipe, a browser or the Mac app turns pages with ← and →, and with a
 * two-finger swipe on a trackpad. Only for the pager on show: a keypress reaches every
 * mounted one, including the one under a sheet or behind the other tab.
 */
function useDesktopTurns(clip: RefObject<View | null>, turn: PagerControl['turn']) {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const element = clip.current as unknown as HTMLElement | null;
    if (!element) return;

    const onTop = () => {
      const r = element.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return hit !== null && element.contains(hit);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (!onTop()) return;
      e.preventDefault();
      turn(e.key === 'ArrowRight' ? 1 : -1);
    };

    let travelled = 0;
    let turned = false;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      clearTimeout(settle);
      settle = setTimeout(() => {
        travelled = 0;
        turned = false;
      }, TRACKPAD.settleMs);
      if (turned) return;
      travelled += e.deltaX;
      if (Math.abs(travelled) < TRACKPAD.distance) return;
      turned = true;
      turn(travelled > 0 ? 1 : -1);
    };

    window.addEventListener('keydown', onKey);
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      clearTimeout(settle);
      window.removeEventListener('keydown', onKey);
      element.removeEventListener('wheel', onWheel);
    };
  }, [clip, turn]);
}

const styles = StyleSheet.create({
  clip: { flex: 1, overflow: 'hidden' },
  strip: { flex: 1, flexDirection: 'row' },
});
