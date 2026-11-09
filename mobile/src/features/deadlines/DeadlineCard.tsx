import { useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { Deadline, deadlineKindLabel, displayTitle } from '../../core/deadline';
import { formatTime } from '../../core/time';
import { Icon, Txt, useReduceMotion } from '../../ui/components';
import { deadlineTint } from '../../ui/meaning';
import { MIN_TARGET, Radius, Space, useTheme, withAlpha } from '../../ui/theme';
import { CompletionSweep } from './DeadlineRows';

const SWEEP_MS = 520;
const SHRINK_MS = 300;

/**
 * One deadline as a card: a grey outline circle, the title, and what it is and when it is due.
 * The circle is the card's one button. Pressing it sweeps the green wash across the card, puts
 * a green tick in the circle, shrinks the card away, and only then reports it done — so the
 * cards below slide up into its place as its height closes, rather than jumping.
 *
 * Tapping anywhere else on the card opens it for editing.
 */
export function DeadlineCard({
  deadline, moduleName, completed, onToggle, onOpen,
}: {
  deadline: Deadline;
  moduleName: string;
  /** Ticked off by this student: the circle is already a tick. */
  completed: boolean;
  /** Called once the card has finished leaving; the list then drops it. */
  onToggle: () => void;
  onOpen: () => void;
}) {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();
  const done = theme.tint.confirmed;
  const [sweep] = useState(() => new Animated.Value(0));
  const [leave] = useState(() => new Animated.Value(1));
  const [height, setHeight] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  // The tick shows from the moment the wash reaches the circle, and stays through the shrink.
  const [ticked, setTicked] = useState(completed);

  const press = () => {
    if (busy) return;
    if (reduceMotion || height === null) return onToggle();
    setBusy(true);
    const shrink = () => {
      Animated.timing(leave, { toValue: 0, duration: SHRINK_MS, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }).start(() => onToggle());
    };
    if (completed) {
      // Taking it back out of Completed needs no celebration: just the circle emptying, and away.
      setTicked(false);
      shrink();
      return;
    }
    sweep.setValue(0);
    Animated.timing(sweep, { toValue: 1, duration: SWEEP_MS, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }).start(() => {
      setTicked(true);
      // A beat on the finished tick before the card goes.
      setTimeout(shrink, 160);
    });
    // The circle takes its tick as the wash passes it, near the start.
    setTimeout(() => setTicked(true), SWEEP_MS * 0.25);
  };

  const graded = deadline.gradeWeight > 0 ? ` · ${deadline.gradeWeight}%` : '';
  const tint = deadlineTint(deadline.kind, theme);

  return (
    <Animated.View
      style={[
        // Measured once, at rest; after that the wrapper's height is what animates.
        height !== null && busy ? { height: leave.interpolate({ inputRange: [0, 1], outputRange: [0, height] }) } : null,
        styles.wrap,
        busy ? { marginBottom: leave.interpolate({ inputRange: [0, 1], outputRange: [0, Space.s] }), opacity: leave, transform: [{ scale: leave.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }] } : null,
      ]}
    >
      <Pressable
        onPress={onOpen}
        onLayout={(e) => {
          if (!busy) setHeight(e.nativeEvent.layout.height);
        }}
        accessibilityRole="button"
        accessibilityLabel={`${displayTitle(deadline)}, ${moduleName}, ${deadlineKindLabel(deadline.kind)}, due ${formatTime(deadline.due)}${completed ? ', completed' : ''}`}
        accessibilityHint="Opens it to edit"
        style={({ pressed }) => [
          styles.card,
          { backgroundColor: theme.surface, borderColor: withAlpha(done, ticked ? 0.5 : 0), opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <Pressable
          onPress={press}
          hitSlop={Space.s}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: completed }}
          accessibilityLabel={completed ? `Mark ${displayTitle(deadline)} not done` : `Mark ${displayTitle(deadline)} done`}
          style={styles.circleHit}
        >
          <View style={[styles.circle, { borderColor: ticked ? done : theme.rail, backgroundColor: ticked ? withAlpha(done, 0.14) : 'transparent' }]}>
            {ticked ? <Icon name="check" size={16} color={done} /> : null}
          </View>
        </Pressable>
        <View style={styles.body}>
          <Txt type="headline" numberOfLines={2} style={completed || ticked ? styles.faded : undefined}>{displayTitle(deadline)}</Txt>
          <View style={styles.meta}>
            <View style={[styles.kind, { backgroundColor: withAlpha(tint, 0.14) }]}>
              <Txt type="caption" color={tint} style={styles.kindText}>{deadlineKindLabel(deadline.kind)}</Txt>
            </View>
            <Txt type="footnote" color={theme.inkSecondary} numberOfLines={1} style={styles.moduleName}>{moduleName}{graded}</Txt>
            <Txt type="footnote" color={theme.inkSecondary} style={styles.time}>{formatTime(deadline.due)}</Txt>
          </View>
        </View>
        {/* The wash runs over the whole card and is clipped to its corners. */}
        {busy && !completed ? <View style={styles.washClip}><CompletionSweep progress={sweep} /></View> : null}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden', marginBottom: Space.s },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: Space.m, paddingVertical: Space.m, paddingRight: Space.l, paddingLeft: Space.s,
    borderRadius: Radius.card + Space.xs, borderWidth: 1.5, overflow: 'hidden',
  },
  circleHit: { width: MIN_TARGET, height: MIN_TARGET, alignItems: 'center', justifyContent: 'center' },
  circle: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: Space.xs },
  meta: { flexDirection: 'row', alignItems: 'center', gap: Space.s },
  kind: { borderRadius: 999, paddingHorizontal: Space.s, paddingVertical: 1 },
  kindText: { fontWeight: '600' },
  moduleName: { flex: 1 },
  time: { fontVariant: ['tabular-nums'] },
  faded: { opacity: 0.55 },
  washClip: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: Radius.card + Space.xs, overflow: 'hidden' },
});
