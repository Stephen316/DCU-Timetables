import * as Haptics from 'expo-haptics';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { AccessibilityActionEvent, Animated, FlatList, Platform, Pressable, StyleSheet, View, ViewStyle } from 'react-native';
import { DatePicking } from '../core/datePicking';
import { Txt } from './components';
import { Radius, Space, Type, useTheme } from './theme';

/** One row of a wheel: a comfortable thumb's height, and what the selection band frames. */
const ROW = 40;
/** Rows either side of the selected one, fading as they turn away. */
const AROUND = 2;
const HEIGHT = ROW * (AROUND * 2 + 1);
const COLUMN = 72;

/**
 * Hours and minutes on two wheels, as Clock sets an alarm: each spins and settles a row at a
 * time, the chosen time on a band across the middle. 24-hour, as times are written
 * everywhere else in the app, and every minute, since 23:59 is the commonest hand-in time.
 * Drawn rather than native so the phone, the browser and the Mac all get the same thing.
 */
export function TimeWheel({ hours, minutes, onChange }: {
  hours: number;
  minutes: number;
  onChange: (hours: number, minutes: number) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.wheels}>
      <View pointerEvents="none" style={[styles.band, { backgroundColor: theme.raised }]} />
      <Wheel count={24} value={hours} label="Hour" onChange={(h) => onChange(h, minutes)} />
      <Txt type="title3" color={theme.inkSecondary} style={styles.colon} importantForAccessibility="no" accessibilityElementsHidden>:</Txt>
      <Wheel count={60} value={minutes} label="Minutes" onChange={(m) => onChange(hours, m)} />
    </View>
  );
}

/**
 * Some of a scroll view's CSS on the web, where react-native-web has no `snapToInterval`:
 * the browser snaps each row to the middle itself, a fling stops at the wheel, and rows
 * drawn in above don't nudge the scroll.
 */
const webSnap = (Platform.OS === 'web' ? { scrollSnapType: 'y mandatory', overscrollBehavior: 'contain', overflowAnchor: 'none' } : {}) as ViewStyle;
const webSnapRow = (Platform.OS === 'web' ? { scrollSnapAlign: 'center' } : {}) as ViewStyle;

/** How long a wheel must be still to have stopped, where no momentum event says so. */
const SETTLE_MS = 120;
/** Long enough for the list to draw the rows a jump lands among. */
const SNAP_PAUSE_MS = 250;

function Wheel({ count, value, label, onChange }: {
  count: number;
  value: number;
  label: string;
  onChange: (value: number) => void;
}) {
  const theme = useTheme();
  const rows = count * DatePicking.wheelCopies(count);
  const list = useRef<FlatList<number>>(null);
  const [data] = useState(() => Array.from({ length: rows }, (_, i) => i));
  const [scrollY] = useState(() => new Animated.Value(DatePicking.wheelRow(value, count) * ROW));
  const [onScroll] = useState(() => Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true }));
  const offset = useRef(DatePicking.wheelRow(value, count) * ROW);
  // The value this wheel last landed on, so its own change echoing back as `value` is no jump.
  const shown = useRef(value);
  const passing = useRef(DatePicking.wheelRow(value, count));
  const dragging = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollTo = (row: number, animated: boolean) => {
    offset.current = row * ROW;
    // A jump on the web lands among rows not drawn yet, and the browser's snap would pull it
    // back to the nearest one that is. Snapping waits until the list has caught up.
    const node = Platform.OS === 'web' && !animated ? (list.current?.getScrollableNode() as HTMLElement | undefined) : undefined;
    if (node) {
      node.style.scrollSnapType = 'none';
      setTimeout(() => {
        node.style.removeProperty('scroll-snap-type');
        node.scrollTop = row * ROW;
      }, SNAP_PAUSE_MS);
    }
    list.current?.scrollToOffset({ offset: row * ROW, animated });
  };

  // A new value from outside — the card reopened on another deadline — turns the wheel to it.
  useEffect(() => {
    if (value === shown.current) return;
    shown.current = value;
    scrollTo(DatePicking.wheelRow(value, count), false);
  }, [value, count]);

  const choose = (next: number) => {
    if (next === shown.current) return;
    shown.current = next;
    onChange(next);
  };

  /** Where the wheel has stopped: that row's value is the choice, and the loop is recentred. */
  const settle = (at?: number) => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = null;
    if (at !== undefined) offset.current = at;
    if (dragging.current) return;
    const row = DatePicking.restingRow(offset.current, ROW, rows);
    const next = DatePicking.wheelValue(row, count);
    choose(next);
    const middle = DatePicking.wheelRow(next, count);
    if (row !== middle) scrollTo(middle, false);
  };

  const settleSoon = () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => settle(), SETTLE_MS);
  };

  const scrolled = useEffectEvent((y: number) => {
    offset.current = y;
    // A light tick for each row that crosses the band, as the real wheel clicks.
    const row = DatePicking.restingRow(y, ROW, rows);
    if (row !== passing.current) {
      passing.current = row;
      if (Platform.OS === 'ios') void Haptics.selectionAsync();
    }
    // The web has no momentum events: a wheel that has stopped moving has stopped.
    settleSoon();
  });

  // Followed in JS as well as drawn natively, for the ticks and to know when it stops.
  useEffect(() => {
    const id = scrollY.addListener(({ value: y }) => scrolled(y));
    return () => {
      scrollY.removeListener(id);
      if (settleTimer.current) clearTimeout(settleTimer.current);
    };
  }, [scrollY]);

  const step = (by: number) => {
    const next = DatePicking.stepWheel(shown.current, by, count);
    choose(next);
    scrollTo(DatePicking.wheelRow(next, count), true);
  };

  const onAccessibilityAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'increment') step(1);
    if (e.nativeEvent.actionName === 'decrement') step(-1);
  };

  const renderItem = ({ item: row }: { item: number }) => {
    const centre = row * ROW;
    const near = (by: number) => centre + by * ROW;
    const opacity = scrollY.interpolate({
      inputRange: [near(-3), near(-2), near(-1), centre, near(1), near(2), near(3)],
      outputRange: [0.15, 0.35, 0.6, 1, 0.6, 0.35, 0.15],
      extrapolate: 'clamp',
    });
    const scale = scrollY.interpolate({
      inputRange: [near(-3), near(-1), centre, near(1), near(3)],
      outputRange: [0.8, 0.92, 1, 0.92, 0.8],
      extrapolate: 'clamp',
    });
    const v = DatePicking.wheelValue(row, count);
    return (
      <Pressable onPress={() => { choose(v); scrollTo(row, true); }} style={[styles.row, webSnapRow]}>
        <Animated.Text style={[Type.title3, styles.figure, { color: theme.ink, opacity, transform: [{ scale }] }]}>
          {pad(v)}
        </Animated.Text>
      </Pressable>
    );
  };

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: pad(value) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={onAccessibilityAction}
      style={styles.column}
    >
      <Animated.FlatList
        ref={list}
        data={data}
        keyExtractor={String}
        renderItem={renderItem}
        // Offsets leave out the spacer above, so a row's offset is the scroll that centres it.
        getItemLayout={(_, index) => ({ length: ROW, offset: ROW * index, index })}
        initialScrollIndex={DatePicking.wheelRow(value, count)}
        initialNumToRender={AROUND * 2 + 3}
        windowSize={5}
        ListHeaderComponent={<View style={styles.spacer} />}
        ListFooterComponent={<View style={styles.spacer} />}
        showsVerticalScrollIndicator={false}
        snapToInterval={ROW}
        decelerationRate="fast"
        scrollEventThrottle={16}
        onScroll={onScroll}
        onScrollBeginDrag={() => { if (Platform.OS !== 'web') dragging.current = true; }}
        onScrollEndDrag={() => {
          // Let go without a flick, there may be no momentum to end; the timer stands in.
          dragging.current = false;
          settleSoon();
        }}
        onMomentumScrollEnd={(e) => settle(e.nativeEvent.contentOffset.y)}
        style={webSnap}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      />
    </View>
  );
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

const styles = StyleSheet.create({
  wheels: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: HEIGHT, gap: Space.xs },
  // Behind the middle row of both wheels and the colon between them.
  band: { position: 'absolute', left: 0, right: 0, top: ROW * AROUND, height: ROW, borderRadius: Radius.control },
  column: { width: COLUMN, height: HEIGHT },
  colon: { fontVariant: ['tabular-nums'] },
  row: { height: ROW, alignItems: 'center', justifyContent: 'center' },
  figure: { fontVariant: ['tabular-nums'] },
  spacer: { height: ROW * AROUND },
});
