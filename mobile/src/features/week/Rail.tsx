import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { formatTime } from '../../core/time';
import { Txt, useLargeText } from '../../ui/components';
import { Space, useTheme } from '../../ui/theme';

/**
 * The day as a line you move along. Every class is a stop on one continuous rail, with its
 * start time set large beside it, so the left edge reads as a clock running down the day.
 * Free time is the rail carrying on, dashed. The class to head for is the one stop drawn in
 * the accent; classes already over shrink to a dot.
 */
export type RailStop =
  | { kind: 'upcoming' }
  | { kind: 'next' }
  | { kind: 'past' }
  /** Carries news: cancelled, moved, a test, something due. Drawn in that news's colour. */
  | { kind: 'flagged'; color: string };

/** Where a row sits in the day, which decides whether the rail runs above and below its stop. */
export interface RailPosition {
  hasAbove: boolean;
  hasBelow: boolean;
}

export function railPosition(index: number, count: number): RailPosition {
  return { hasAbove: index > 0, hasBelow: index < count - 1 };
}

const GUTTER = 58;
const COLUMN = 28;
/** From the top of a row to the middle of its first line — where the stop sits. */
const STOP_CENTRE = 12;
const STOP = 11;
const LINE = 2;

/**
 * One class on the rail. At the accessibility text sizes the times move above the content
 * instead of beside it, so the title keeps the full width.
 */
export function RailRow({ start, end, stop, position, children }: {
  start: Date;
  end: Date;
  stop: RailStop;
  position: RailPosition;
  children: ReactNode;
}) {
  const theme = useTheme();
  const stacked = useLargeText();
  const timeColour = stop.kind === 'next' ? theme.accent : stop.kind === 'past' ? theme.inkSecondary : theme.ink;
  const railX = (stacked ? 0 : GUTTER) + COLUMN / 2;
  const stopY = Space.m + STOP_CENTRE;

  return (
    <View style={styles.row}>
      {/* The line through the row, and the stop on it. */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View
          style={[styles.line, {
            left: railX - LINE / 2,
            top: position.hasAbove ? 0 : stopY,
            // Down to the next row, or stopping at this row's stop.
            bottom: position.hasBelow ? 0 : undefined,
            height: position.hasBelow ? undefined : position.hasAbove ? stopY : 0,
            backgroundColor: theme.rail,
          }]}
        />
        <View style={{ position: 'absolute', left: railX, top: stopY }}>
          <StopMark stop={stop} />
        </View>
      </View>

      {!stacked ? (
        <View style={styles.times} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Txt type="railStart" color={timeColour}>{formatTime(start)}</Txt>
          <Txt type="railEnd" color={theme.inkSecondary}>{formatTime(end)}</Txt>
        </View>
      ) : null}
      <View style={styles.column} />
      <View style={styles.content}>
        {stacked ? (
          <View style={styles.stackedTimes}>
            <Txt type="railStart" color={timeColour}>{formatTime(start)}</Txt>
            <Txt type="railEnd" color={theme.inkSecondary}>to {formatTime(end)}</Txt>
          </View>
        ) : null}
        {children}
      </View>
    </View>
  );
}

/** Free time between two classes: the rail carries on, dashed, with nothing on it. */
export function RailGap({ start, end, label }: { start: Date; end: Date; label: string }) {
  const theme = useTheme();
  const stacked = useLargeText();
  const railX = (stacked ? 0 : GUTTER) + COLUMN / 2;
  return (
    <View
      style={styles.gap}
      accessible
      accessibilityLabel={`${label}, ${formatTime(start)} to ${formatTime(end)}`}
    >
      <View pointerEvents="none" style={[styles.dashes, { left: railX - LINE / 2 }]}>
        {Array.from({ length: 30 }, (_, i) => (
          <View key={i} style={[styles.dash, { backgroundColor: theme.rail }]} />
        ))}
      </View>
      <View style={{ width: (stacked ? 0 : GUTTER) + COLUMN }} />
      <Txt type="footnote" color={theme.inkTertiary} style={styles.content}>{label}</Txt>
    </View>
  );
}

function StopMark({ stop }: { stop: RailStop }) {
  const theme = useTheme();
  const centred = (size: number) => ({ width: size, height: size, borderRadius: size / 2, marginLeft: -size / 2, marginTop: -size / 2 });
  switch (stop.kind) {
    case 'upcoming':
      // Filled with the canvas so the rail doesn't show through the ring.
      return <View style={[centred(STOP), { backgroundColor: theme.canvas, borderWidth: LINE, borderColor: theme.rail }]} />;
    case 'past':
      return <View style={[centred(STOP * 0.55), { backgroundColor: theme.rail }]} />;
    case 'next':
      // A halo as well as a fill, so it doesn't rely on the accent's hue alone.
      return (
        <View style={[centred(STOP + 12), styles.halo, { borderColor: theme.accent + '59' }]}>
          <View style={{ width: STOP, height: STOP, borderRadius: STOP / 2, backgroundColor: theme.accent }} />
        </View>
      );
    case 'flagged':
      return <View style={[centred(STOP), { backgroundColor: stop.color }]} />;
  }
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: Space.m, paddingRight: Space.l },
  times: { width: GUTTER, alignItems: 'flex-end', gap: Space.xxs },
  column: { width: COLUMN },
  content: { flex: 1, gap: Space.xs },
  stackedTimes: { flexDirection: 'row', alignItems: 'baseline', gap: Space.s },
  line: { position: 'absolute', width: LINE },
  gap: { flexDirection: 'row', alignItems: 'center', paddingVertical: Space.l, paddingRight: Space.l, overflow: 'hidden' },
  dashes: { position: 'absolute', top: 0, bottom: 0, width: LINE, overflow: 'hidden' },
  dash: { width: LINE, height: 3, marginBottom: 4 },
  halo: { borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
});
