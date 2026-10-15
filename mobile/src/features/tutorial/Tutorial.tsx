import { router } from 'expo-router';
import {
  createContext, ReactNode, RefObject, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Tutorial, TutorialSignal, TutorialStep, TutorialTarget, TutorialText } from '../../core/tutorial';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MacShell } from '../../data/macShell';
import { PrefKey } from '../../data/storage';
import { usePrefBool, useServices } from '../../state/hooks';
import { useRoot } from '../../state/root';
import { Icon, Txt, useReduceMotion } from '../../ui/components';
import { Radius, Space, useTheme, withAlpha } from '../../ui/theme';

/**
 * The first-run tutorial: the screen dimmed but for one control at a time, an arrow and a
 * card saying what it is. It runs once after an account is created here (`tutorialDue`), and
 * again from Account. The steps and their words are in core/tutorial.ts.
 *
 * Controls take part by registering as a target (`useTutorialTarget`); the overlay finds the
 * one on screen and measures it as it goes, so a scroll or a page turn is followed.
 */

interface Rect { x: number; y: number; width: number; height: number }

interface TutorialState {
  register(target: TutorialTarget, ref: RefObject<View | null>): () => void;
  /** The student did something a step may be waiting for. */
  signal(signal: TutorialSignal): void;
  /** The timetable has its first week, so there are classes to point at. */
  markReady(): void;
  /** From Account. */
  replay(): void;
  /** A report made now is the tour's practice: shown on this phone and sent nowhere. */
  practising: boolean;
  /** Pages may be swiped: no tour, or the step that asks for a swipe. */
  swipeAllowed: boolean;
  /** A finger is dragging a page or a list; the card steps out of the way until it lifts. */
  setDragging(dragging: boolean): void;
}

const TutorialContext = createContext<TutorialState | null>(null);

/** A ref to put on a control the tutorial can point at. `active` false leaves it out. */
export function useTutorialTarget(target: TutorialTarget, active = true): RefObject<View | null> {
  const tutorial = useContext(TutorialContext);
  const ref = useRef<View | null>(null);
  useEffect(() => (tutorial && active ? tutorial.register(target, ref) : undefined), [tutorial, target, active]);
  return ref;
}

export function useTutorial(): TutorialState | null {
  return useContext(TutorialContext);
}

/** How long a step waits for its control to appear before it's left out (an empty day, say). */
const MISSING_MS = 1500;
/** Breathing room between the control and the edge of the cut-out. */
const PAD = 6;

export function TutorialProvider({ children }: { children: ReactNode }) {
  const services = useServices();
  const { flow, model } = useRoot();
  const [due, setDue] = usePrefBool(PrefKey.tutorialDue);
  const [ready, setReady] = useState(false);
  const [run, setRun] = useState<{ steps: TutorialStep[]; index: number } | null>(null);
  const targets = useRef(new Map<TutorialTarget, Set<RefObject<View | null>>>());
  const [dragging, setDragging] = useState(false);

  // TEMPORARY — remove once existing students have had it (from early November 2026): the
  // tour is new, so everyone already signed in on this phone is offered it once, as a new
  // account is. Remove this effect and `PrefKey.tutorialOfferedToExisting` together.
  useEffect(() => {
    if (flow !== 'shell' || services.prefs.getBool(PrefKey.tutorialOfferedToExisting)) return;
    services.prefs.setBool(PrefKey.tutorialOfferedToExisting, true);
    setDue(true);
  }, [flow, services, setDue]);

  // Not the moment the timetable appears: a sheet may still be closing (a replay from
  // Account), and the first week may still be drawing. The tour starts on today's list.
  useEffect(() => {
    if (!due || !ready || run || flow !== 'shell') return;
    const timer = setTimeout(() => {
      const onMac = MacShell.isPresent();
      if (!onMac) services.prefs.setBool(PrefKey.weekShowsCalendar, false);
      model?.resetToDefaultDay(new Date(), false);
      setRun({ steps: Tutorial.steps(onMac), index: 0 });
    }, 600);
    return () => clearTimeout(timer);
  }, [due, ready, run, flow, model, services]);

  // Signed out mid-tour: nothing left to point at, and nothing to pick up again later.
  if (flow !== 'shell' && run) setRun(null);

  const step = run ? run.steps[run.index] : null;
  const isLast = run ? run.index === run.steps.length - 1 : false;

  // A step on the timetable reached from somewhere else — More, after Deadlines — takes the
  // student there, rather than asking them to find their way back.
  const toTimetable = step?.toTimetable ?? false;
  useEffect(() => {
    if (!toTimetable) return;
    if (router.canDismiss()) router.dismissAll();
    router.navigate('/');
  }, [toTimetable, step]);

  // Ends where the student is: on the timetable, in the week they switched to.
  const finish = useCallback(() => {
    setDue(false);
    setRun(null);
    if (router.canDismiss()) router.dismissAll();
    router.navigate('/');
  }, [setDue]);

  /** Next, or a step whose control never appeared. */
  const skipOn = useCallback(() => {
    if (!run) return;
    const current = run.steps[run.index];
    const index = Tutorial.next(run.steps, run.index, false);
    // Left a class's page without its own Back step: take the student out of it.
    if (current.continues && run.steps[index]?.action !== 'back' && router.canGoBack()) router.back();
    if (index >= run.steps.length) finish();
    else setRun({ ...run, index });
  }, [run, finish]);

  const practising = step?.practice ?? false;
  const swipeAllowed = !step || step.action === 'swipeLeft';
  const state = useMemo<TutorialState>(() => ({
    register(target, ref) {
      const set = targets.current.get(target) ?? new Set();
      set.add(ref);
      targets.current.set(target, set);
      return () => {
        set.delete(ref);
      };
    },
    signal(signal) {
      setRun((current) => {
        if (!current || current.steps[current.index]?.advancesOn !== signal) return current;
        return { ...current, index: Tutorial.next(current.steps, current.index, true) };
      });
    },
    markReady: () => setReady(true),
    replay: () => setDue(true),
    practising,
    swipeAllowed,
    setDragging,
  }), [setDue, practising, swipeAllowed]);

  return (
    <TutorialContext.Provider value={state}>
      {children}
      {run && step && !step.hidden ? (
        <Overlay
          key={step.id}
          step={step}
          position={Tutorial.position(run.steps, run.index)}
          targets={targets}
          onPrimary={isLast ? finish : skipOn}
          onSkip={finish}
          onMissing={isLast ? finish : skipOn}
          dragging={dragging}
        />
      ) : null}
    </TutorialContext.Provider>
  );
}

/** One step: the dim with its cut-out, the arrow, the moving hand and the card. */
function Overlay({ step, position, targets, onPrimary, onSkip, onMissing, dragging }: {
  step: TutorialStep;
  position: { n: number; total: number };
  targets: RefObject<Map<TutorialTarget, Set<RefObject<View | null>>>>;
  onPrimary: () => void;
  onSkip: () => void;
  onMissing: () => void;
  /** The student's finger is on the page: the card and hints wait until it lifts. */
  dragging: boolean;
}) {
  const theme = useTheme();
  const window = useWindowDimensions();
  const [rect, setRect] = useState<Rect | null>(null);
  const [cardHeight, setCardHeight] = useState(180);
  const [fade] = useState(() => new Animated.Value(0));
  const reduceMotion = useReduceMotion();
  // Read by the measuring loop, which shouldn't restart (and reset its patience) on a render.
  const missing = useRef(onMissing);
  useEffect(() => {
    missing.current = onMissing;
  });

  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: reduceMotion ? 0 : 200, useNativeDriver: true }).start();
  }, [fade, reduceMotion]);

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility([step.title, step.body].filter(Boolean).join('. '));
  }, [step]);

  // Follows the control every frame — a scroll, a page turn, the keyboard — so the cut-out
  // stays on it rather than trailing behind; and gives up on a control that never appears,
  // so a missing one can't strand the tour.
  useEffect(() => {
    if (!step.target) return;
    const target = step.target;
    const began = Date.now();
    let found = false;
    let stopped = false;
    let measuring = false;
    let frame = 0;
    const measure = (finished: () => void) => {
      const refs = [...(targets.current?.get(target) ?? [])];
      let best: Rect | null = null;
      let pending = refs.length;
      const done = () => {
        finished();
        if (stopped) return;
        // A scroll step's section is there all along, just below the fold: waiting for the
        // student to bring it up isn't the same as it missing.
        if (best || (step.action === 'scrollDown' && refs.some((r) => r.current))) found = true;
        setRect((old) => (same(old, best) ? old : best));
        if (!found && Date.now() - began > MISSING_MS) {
          found = true;
          missing.current();
        }
      };
      if (pending === 0) return done();
      for (const ref of refs) {
        const view = ref.current;
        if (!view) {
          if (--pending === 0) done();
          continue;
        }
        view.measureInWindow((x, y, width, height) => {
          const r = { x, y, width, height };
          // The one on screen: the pager keeps the pages either side drawn, off to the side.
          if (onScreen(r, window.width, window.height, step.action === 'scrollDown') && (!best || area(r) > area(best))) best = r;
          if (--pending === 0) done();
        });
      }
    };
    const tick = () => {
      if (stopped) return;
      if (!measuring) {
        measuring = true;
        measure(() => {
          measuring = false;
        });
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
    };
  }, [step, targets, window.width, window.height]);

  // Padded, but kept on screen: a full-width row would otherwise lose its outline's sides.
  const hole = rect ? inside({ x: rect.x - PAD, y: rect.y - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }, window) : null;
  // The page stays usable — lightly dimmed, nothing blocked — while a scroll step waits for its
  // control to come into view, and while the student finds Back.
  const free = (step.action === 'scrollDown' && !hole) || step.action === 'back';
  const scrolling = step.action === 'scrollDown' && !hole;
  // Touches reach the control under the cut-out whenever the step is for pressing it.
  const passThrough = step.action === 'swipeLeft' || step.action === 'tap' || step.action === 'scrollDown';
  // A scroll step's control, once in view, is pressed like any other.
  const gesture = step.action === 'scrollDown' && hole ? 'tap' : step.action;
  const title = step.arrived && hole ? step.arrived.title : step.title;
  const body = step.arrived && hole ? step.arrived.body : step.body;

  // The card goes on the roomier side of the cut-out, with the arrow between; a cut-out with
  // no room either side (the whole week grid) has the card along its foot.
  // The arrow gets a clear lane between the cut-out and the card, so it reads as pointing
  // rather than squeezed between the two.
  const ARROW = 30;
  const GAP = 12;
  const LANE = GAP + ARROW + GAP;
  const MARGIN = Space.l;
  const cardWidth = Math.min(window.width - MARGIN * 2, 380);
  const cardLeft = (window.width - cardWidth) / 2;
  let cardTop: number;
  let arrow: { top: number; left: number; up: boolean } | null = null;
  if (!hole) {
    cardTop = scrolling ? window.height * 0.12 : step.action === 'back' ? window.height * 0.3 : (window.height - cardHeight) / 2;
  } else {
    const above = hole.y;
    const below = window.height - (hole.y + hole.height);
    const centreX = Math.min(Math.max(hole.x + hole.width / 2, MARGIN + ARROW / 2), window.width - MARGIN - ARROW / 2);
    if (below >= cardHeight + LANE + MARGIN && below >= above) {
      cardTop = hole.y + hole.height + LANE;
      arrow = { top: hole.y + hole.height + GAP, left: centreX - ARROW / 2, up: true };
    } else if (above >= cardHeight + LANE + MARGIN) {
      cardTop = hole.y - LANE - cardHeight;
      arrow = { top: hole.y - GAP - ARROW, left: centreX - ARROW / 2, up: false };
    } else {
      cardTop = Math.min(hole.y + hole.height, window.height) - cardHeight - MARGIN * 2;
    }
  }

  const dim = 'rgba(0, 0, 0, 0.6)';
  return (
    // Clipped to the screen: the dim's border reaches far past it, and in a browser that would
    // widen the page and let it scroll sideways.
    <Animated.View style={[StyleSheet.absoluteFill, styles.clip, { opacity: fade }]} pointerEvents="box-none">
      {/* The dim, drawn as one huge border round the cut-out so its corners can be rounded. */}
      {hole ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: hole.x - BORDER, top: hole.y - BORDER,
            width: hole.width + BORDER * 2, height: hole.height + BORDER * 2,
            borderWidth: BORDER, borderColor: dim, borderRadius: BORDER + Radius.control,
          }}
        />
      ) : (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: free ? 'rgba(0, 0, 0, 0.25)' : dim }]} />
      )}
      {hole ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute', left: hole.x, top: hole.y, width: hole.width, height: hole.height,
            borderRadius: Radius.control, borderWidth: 2, borderColor: theme.accent,
          }}
        />
      ) : null}

      {/* What a stray tap lands on: everything but the card, and the cut-out when it's live. */}
      {free ? null : hole ? (
        <>
          <Blocker style={{ left: 0, top: 0, right: 0, height: Math.max(hole.y, 0) }} />
          <Blocker style={{ left: 0, top: hole.y + hole.height, right: 0, bottom: 0 }} />
          <Blocker style={{ left: 0, top: hole.y, width: Math.max(hole.x, 0), height: hole.height }} />
          <Blocker style={{ left: hole.x + hole.width, top: hole.y, right: 0, height: hole.height }} />
          {passThrough ? null : <Blocker style={{ left: hole.x, top: hole.y, width: hole.width, height: hole.height }} />}
        </>
      ) : (
        <Blocker style={StyleSheet.absoluteFill} />
      )}

      {arrow && !dragging ? (
        <View pointerEvents="none" style={{ position: 'absolute', top: arrow.top, left: arrow.left }}>
          <Icon name={arrow.up ? 'arrowUp' : 'arrowDown'} size={ARROW} color={theme.accent} />
        </View>
      ) : null}
      {gesture && (hole || free) && !dragging ? <Gesture action={gesture} hole={hole} window={window} /> : null}

      {dragging ? null : <View
        // Only when there's nothing else to press: VoiceOver must still reach a control the step is for.
        accessibilityViewIsModal={!passThrough && !free}
        onLayout={(e) => setCardHeight(e.nativeEvent.layout.height)}
        style={[styles.card, { top: cardTop, left: cardLeft, width: cardWidth, backgroundColor: theme.surface, borderColor: theme.separator }]}
      >
        <Txt type="caption" color={theme.inkTertiary}>{TutorialText.count(position.n, position.total)}</Txt>
        <Txt type="headline" accessibilityRole="header">{title}</Txt>
        {body ? <Txt type="subheadline" color={theme.inkSecondary}>{body}</Txt> : null}
        <View style={styles.buttons}>
          {step.skip ? (
            <Pressable onPress={onSkip} accessibilityRole="button" hitSlop={8} style={({ pressed }) => [styles.skip, pressed && styles.pressed]}>
              <Txt type="subheadline" color={theme.inkSecondary}>{step.skip}</Txt>
            </Pressable>
          ) : <View />}
          {step.primary ? (
            <Pressable
              onPress={onPrimary}
              accessibilityRole="button"
              style={({ pressed }) => [styles.primary, { backgroundColor: theme.accent }, pressed && styles.pressed]}
            >
              <Txt type="subheadline" color={theme.canvas} style={styles.semibold}>{step.primary}</Txt>
            </Pressable>
          ) : null}
        </View>
      </View>}
    </Animated.View>
  );
}

/** Wide enough to reach every edge of any screen from the cut-out. */
const BORDER = 3000;

function Blocker({ style }: { style: object }) {
  return <View style={[styles.blocker, style]} importantForAccessibility="no" accessibilityElementsHidden />;
}

/**
 * The movement to make, shown as a fingertip making it: a round touch that presses down,
 * travels a gentle curve and lifts, leaving a fading trail behind — across the cut-out for a
 * swipe, up the screen for a scroll. A tap presses in place with a ring spreading from it.
 * Under Reduce Motion, the fingertip holds still with an arrow beside it.
 */
function Gesture({ action, hole, window }: {
  action: NonNullable<TutorialStep['action']>;
  hole: Rect | null;
  window: { width: number; height: number };
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const [t] = useState(() => new Animated.Value(0));
  const moves = action === 'swipeLeft' || action === 'scrollDown';
  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(t, { toValue: 1, duration: moves ? 1300 : 1100, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
      Animated.delay(450),
    ]));
    loop.start();
    return () => {
      loop.stop();
      t.setValue(0);
    };
  }, [t, reduceMotion, moves]);

  // Where the fingertip starts, and the curve it follows from there.
  const area = hole ?? { x: 0, y: 0, width: window.width, height: window.height };
  let origin: { x: number; y: number };
  let path: { dx: [number, number, number]; dy: [number, number, number] };
  if (action === 'swipeLeft') {
    const span = Math.min(area.width * 0.32, 130);
    origin = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
    // Right to left, dipping in a shallow arc as a thumb does.
    path = { dx: [span, 0, -span], dy: [0, -18, 0] };
  } else if (action === 'scrollDown') {
    const span = window.height * 0.13;
    origin = { x: window.width / 2, y: window.height * 0.5 };
    // Bottom to top, bowing slightly to the side.
    path = { dx: [0, 22, 0], dy: [span, 0, -span] };
  } else if (action === 'back') {
    origin = { x: Space.l + Space.s, y: insets.top + 22 };
    path = { dx: [0, 0, 0], dy: [0, 0, 0] };
  } else {
    origin = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
    path = { dx: [0, 0, 0], dy: [0, 0, 0] };
  }

  // The fingertip, and the trail of fainter dots that follow it a beat behind.
  const along = (lag: number) => {
    const input = [lag, 0.5 + lag / 2, 1];
    return {
      translateX: t.interpolate({ inputRange: input, outputRange: path.dx, extrapolate: 'clamp' }),
      translateY: t.interpolate({ inputRange: input, outputRange: path.dy, extrapolate: 'clamp' }),
    };
  };
  const visible = t.interpolate({ inputRange: [0, 0.08, 0.85, 1], outputRange: [0, 1, 1, 0] });
  const press = t.interpolate({ inputRange: [0, 0.1, 0.9, 1], outputRange: [1.25, 1, 1, 1.25] });
  const ring = t.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] });
  const ringFade = t.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.6, 0] });

  const TIP = 26;
  const at = { position: 'absolute' as const, left: origin.x - TIP / 2, top: origin.y - TIP / 2 };
  const tip = [styles.tip, { backgroundColor: withAlpha(theme.accent, 0.85), borderColor: theme.surface }];

  if (reduceMotion) {
    const arrow = action === 'swipeLeft' ? 'arrowLeft' : action === 'scrollDown' ? 'arrowUp' : null;
    return (
      <View pointerEvents="none" style={[at, styles.still]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={tip} />
        {arrow ? <Icon name={arrow} size={20} color={theme.accent} /> : null}
      </View>
    );
  }
  return (
    <View pointerEvents="none" style={at} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {moves
        ? [0.18, 0.12, 0.06].map((lag, i) => (
            <Animated.View
              key={lag}
              style={[styles.trail, {
                backgroundColor: theme.accent,
                opacity: Animated.multiply(visible, 0.18 + i * 0.12),
                transform: [{ translateX: along(lag).translateX }, { translateY: along(lag).translateY }],
              }]}
            />
          ))
        : (
            <Animated.View style={[styles.ring, { borderColor: theme.accent, opacity: ringFade, transform: [{ scale: ring }] }]} />
          )}
      <Animated.View
        style={[tip, {
          opacity: moves ? visible : 1,
          transform: [{ translateX: along(0).translateX }, { translateY: along(0).translateY }, { scale: press }],
        }]}
      />
    </View>
  );
}

function onScreen(r: Rect, width: number, height: number, wholeInView: boolean): boolean {
  if (r.width <= 0 || r.height <= 0) return false;
  const across = r.x + r.width > 1 && r.x < width - 1;
  // A section scrolled to: its top well inside the screen, not just a sliver at the bottom.
  if (wholeInView) return across && r.y >= 0 && r.y < height * 0.6;
  return across && r.y + r.height > 1 && r.y < height - 1;
}

function inside(r: Rect, window: { width: number; height: number }): Rect {
  const EDGE = 3;
  const x = Math.max(r.x, EDGE);
  const y = Math.max(r.y, EDGE);
  return { x, y, width: Math.min(r.x + r.width, window.width - EDGE) - x, height: Math.min(r.y + r.height, window.height - EDGE) - y };
}

function area(r: Rect): number {
  return r.width * r.height;
}

function same(a: Rect | null, b: Rect | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute', padding: Space.l, gap: Space.xs, borderRadius: Radius.control, borderWidth: StyleSheet.hairlineWidth,
  },
  buttons: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Space.s },
  skip: { paddingVertical: Space.s },
  primary: { paddingVertical: Space.s, paddingHorizontal: Space.l, borderRadius: Radius.control, minWidth: 88, alignItems: 'center' },
  semibold: { fontWeight: '600' },
  pressed: { opacity: 0.6 },
  blocker: { position: 'absolute' },
  clip: { overflow: 'hidden' },
  tip: { width: 26, height: 26, borderRadius: 13, borderWidth: 2 },
  trail: { position: 'absolute', left: 5, top: 5, width: 16, height: 16, borderRadius: 8 },
  ring: { position: 'absolute', left: 0, top: 0, width: 26, height: 26, borderRadius: 13, borderWidth: 2 },
  still: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
});
