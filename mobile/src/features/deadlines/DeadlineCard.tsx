import { useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { Deadline, deadlineKindLabel, displayTitle } from '../../core/deadline';
import { daysBetween, formatTime, monthName, weekdayShort } from '../../core/time';
import { Avatar, Icon, Txt, useReduceMotion } from '../../ui/components';
import { deadlineTint } from '../../ui/meaning';
import { useNow } from '../../state/hooks';
import { elevation, MIN_TARGET, moduleTint, Radius, Space, useTheme, withAlpha } from '../../ui/theme';
import { CompletionSweep, moduleInitials } from './DeadlineRows';

const SWEEP_MS = 520;
/** "Shrinks a bit": the card gives way before it goes. */
const GIVE_MS = 140;
/** Then it fades as the space it took closes, and the cards below slide up into it. */
const CLOSE_MS = 260;

/**
 * When it's due, as short as the day allows: "18:00" today, "Thu 18:00" this week, "18 Nov"
 * later — and "18 Nov" for one already gone, which a time or weekday alone would misdate.
 */
export function dueLabel(due: Date, now: Date): string {
  const days = daysBetween(now, due);
  if (days < 0) return `${due.getDate()} ${monthName(due).slice(0, 3)}`;
  if (days === 0) return formatTime(due);
  if (days < 7) return `${weekdayShort(due)} ${formatTime(due)}`;
  return `${due.getDate()} ${monthName(due).slice(0, 3)}`;
}

/**
 * One deadline as a card, as the reference's class cards are drawn: the title large, and under
 * it what it is, whose module (a badge in the module's timetable colour) and when.
 *
 * The grey outline circle is the card's one button. Pressing it sweeps the green wash across
 * the card and puts a green tick in the circle; where the card `leaves` its list (Pending and
 * Completed), it then gives a little, fades, and its space closes so the cards below slide up
 * into it, and only then is it reported done. Tapping anywhere else opens it.
 */
export function DeadlineCard({
  deadline, moduleName, completed, onToggle, onOpen, leaves = true,
}: {
  deadline: Deadline;
  moduleName: string;
  /** Ticked off by this student: the circle already holds a tick. */
  completed: boolean;
  /** Called once the card has finished its animation. */
  onToggle: () => void;
  onOpen: () => void;
  /** Ticking moves it to another list, so it leaves this one; on a class's page it stays. */
  leaves?: boolean;
}) {
  const theme = useTheme();
  const now = useNow();
  const reduceMotion = useReduceMotion();
  const done = theme.tint.confirmed;
  const [sweep] = useState(() => new Animated.Value(0));
  const [give] = useState(() => new Animated.Value(1));
  const [close] = useState(() => new Animated.Value(1));
  const [height, setHeight] = useState<number | null>(null);
  /** Mid-animation, the tick the circle shows; otherwise the circle shows `completed`. */
  const [shownTick, setShownTick] = useState<boolean | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const busy = shownTick !== null;
  const ticked = shownTick ?? completed;

  const leave = () => {
    Animated.sequence([
      Animated.timing(give, { toValue: 0, duration: GIVE_MS, easing: Easing.out(Easing.quad), useNativeDriver: false }),
      Animated.timing(close, { toValue: 0, duration: CLOSE_MS, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }),
    ]).start(() => onToggle());
  };

  const press = () => {
    if (busy) return;
    if (reduceMotion || height === null) return onToggle();
    if (completed) {
      // Taking it back needs no celebration: the circle empties, and the card goes back.
      if (!leaves) return onToggle();
      setShownTick(false);
      return leave();
    }
    setShownTick(false);
    setSweeping(true);
    sweep.setValue(0);
    // The circle takes its tick as the wash passes it, near the start.
    setTimeout(() => setShownTick(true), SWEEP_MS * 0.25);
    Animated.timing(sweep, { toValue: 1, duration: SWEEP_MS, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }).start(() => {
      if (!leaves) {
        setSweeping(false);
        setShownTick(null);
        return onToggle();
      }
      // A beat on the finished tick before the card goes.
      setTimeout(leave, 140);
    });
  };

  const kindTint = deadlineTint(deadline.kind, theme);
  const graded = deadline.gradeWeight > 0 ? ` · ${deadline.gradeWeight}%` : '';

  return (
    <Animated.View
      style={[
        styles.wrap,
        // Measured at rest; while it leaves, the space it takes is what animates.
        busy && height !== null && leaves
          ? {
              overflow: 'hidden',
              height: close.interpolate({ inputRange: [0, 1], outputRange: [0, height] }),
              marginBottom: close.interpolate({ inputRange: [0, 1], outputRange: [0, Space.s] }),
            }
          : null,
      ]}
    >
      <Animated.View
        onLayout={(e) => {
          if (!busy) setHeight(e.nativeEvent.layout.height);
        }}
        style={{
          opacity: close.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 0.4, 1] }),
          transform: [{ scale: Animated.add(give.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1] }), close.interpolate({ inputRange: [0, 1], outputRange: [-0.05, 0] })) }],
        }}
      >
        <Pressable
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel={`${displayTitle(deadline)}, ${deadlineKindLabel(deadline.kind)}, ${moduleName}, due ${dueLabel(deadline.due, now)}${completed ? ', completed' : ''}`}
          accessibilityHint="Opens it"
          style={({ pressed }) => [styles.card, { backgroundColor: theme.surface, opacity: pressed ? 0.85 : 1 }, elevation(theme)]}
        >
          <Pressable
            onPress={press}
            hitSlop={Space.xs}
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
            <Txt type="headline" numberOfLines={2} style={[styles.title, ticked && styles.faded]}>{displayTitle(deadline)}</Txt>
            <View style={styles.meta}>
              <View style={[styles.kind, { backgroundColor: withAlpha(kindTint, 0.14) }]}>
                <Txt type="caption" color={kindTint} style={styles.semibold}>{deadlineKindLabel(deadline.kind)}</Txt>
              </View>
              <View style={styles.module}>
                <Avatar text={moduleInitials(moduleName)} color={moduleTint(theme, deadline.moduleKey)} size={22} />
                <Txt type="footnote" color={theme.ink} numberOfLines={1} style={styles.shrink}>{moduleName}{graded}</Txt>
              </View>
              <Txt type="footnote" color={theme.inkSecondary} style={styles.time}>{dueLabel(deadline.due, now)}</Txt>
            </View>
          </View>
          {/* The wash runs over the whole card, clipped to its corners. */}
          {sweeping ? <View style={styles.washClip}><CompletionSweep progress={sweep} /></View> : null}
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: Space.s, overflow: 'visible' },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: Space.xs, paddingVertical: Space.m + 2, paddingRight: Space.l, paddingLeft: Space.xs,
    borderRadius: Radius.card + 2,
  },
  circleHit: { width: MIN_TARGET, height: MIN_TARGET, alignItems: 'center', justifyContent: 'center' },
  circle: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: Space.s },
  title: { fontWeight: '700' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: Space.s },
  kind: { borderRadius: 999, paddingHorizontal: Space.s, paddingVertical: 2 },
  semibold: { fontWeight: '600' },
  module: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Space.xs, minWidth: 0 },
  shrink: { flexShrink: 1 },
  time: { fontVariant: ['tabular-nums'] },
  faded: { opacity: 0.5 },
  washClip: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: Radius.card + 2, overflow: 'hidden' },
});
