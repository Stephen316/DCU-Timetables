import { router } from 'expo-router';
import {
  createContext, ReactNode, RefObject, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Tutorial, TutorialSignal, TutorialStep, TutorialTarget, TutorialText } from '../../core/tutorial';
import { MacShell } from '../../data/macShell';
import { PrefKey } from '../../data/storage';
import { usePrefBool, useServices } from '../../state/hooks';
import { useRoot } from '../../state/root';
import { Icon, Txt, useReduceMotion } from '../../ui/components';
import { Radius, Space, useTheme } from '../../ui/theme';

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
const MEASURE_MS = 200;
/** Breathing room between the control and the edge of the cut-out. */
const PAD = 6;

export function TutorialProvider({ children }: { children: ReactNode }) {
  const services = useServices();
  const { flow, model } = useRoot();
  const [due, setDue] = usePrefBool(PrefKey.tutorialDue);
  const [ready, setReady] = useState(false);
  const [run, setRun] = useState<{ steps: TutorialStep[]; index: number } | null>(null);
  const targets = useRef(new Map<TutorialTarget, Set<RefObject<View | null>>>());
  /** The view the student had before the tour switched to the day list, put back after. */
  const savedView = useRef<boolean | null>(null);

  // TEMPORARY — remove once existing students have had it (from early November 2026): the
  // tour is new, so everyone already signed in on this phone is offered it once, as a new
  // account is. Remove this effect and `PrefKey.tutorialOfferedToExisting` together.
  useEffect(() => {
    if (flow !== 'shell' || services.prefs.getBool(PrefKey.tutorialOfferedToExisting)) return;
    services.prefs.setBool(PrefKey.tutorialOfferedToExisting, true);
    setDue(true);
  }, [flow, services, setDue]);

  // Not the moment the timetable appears: a sheet may still be closing (a replay from
  // Account), and the first week may still be drawing.
  useEffect(() => {
    if (!due || !ready || run || flow !== 'shell') return;
    const timer = setTimeout(() => {
      const onMac = MacShell.isPresent();
      if (!onMac) {
        savedView.current = services.prefs.getBool(PrefKey.weekShowsCalendar);
        services.prefs.setBool(PrefKey.weekShowsCalendar, false);
      }
      model?.resetToDefaultDay(new Date(), false);
      setRun({ steps: Tutorial.steps(onMac), index: 0 });
    }, 600);
    return () => clearTimeout(timer);
  }, [due, ready, run, flow, model, services]);

  // Signed out mid-tour: nothing left to point at, and nothing to pick up again later.
  if (flow !== 'shell' && run) setRun(null);

  const finish = useCallback(() => {
    setDue(false);
    setRun(null);
    if (savedView.current !== null) services.prefs.setBool(PrefKey.weekShowsCalendar, savedView.current);
    savedView.current = null;
    // Back where the app opens: the timetable, on today.
    if (router.canDismiss()) router.dismissAll();
    router.navigate('/');
    model?.resetToDefaultDay(new Date(), false);
  }, [setDue, services, model]);

  const advance = useCallback(() => {
    if (!run) return;
    // Leaving the class's page for the steps on the timetable.
    if (run.steps[run.index].screen === 'class' && router.canGoBack()) router.back();
    const index = Tutorial.next(run.steps, run.index, false);
    setRun(index < run.steps.length ? { ...run, index } : run);
  }, [run]);

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
  }), [setDue]);

  const step = run ? run.steps[run.index] : null;
  const isLast = run ? run.index === run.steps.length - 1 : false;

  return (
    <TutorialContext.Provider value={state}>
      {children}
      {run && step ? (
        <Overlay
          key={step.id}
          step={step}
          position={Tutorial.position(run.steps, run.index)}
          targets={targets}
          onPrimary={isLast ? finish : advance}
          onSkip={finish}
          onMissing={isLast ? finish : advance}
        />
      ) : null}
    </TutorialContext.Provider>
  );
}

/** One step: the dim with its cut-out, the arrow, the moving hand and the card. */
function Overlay({ step, position, targets, onPrimary, onSkip, onMissing }: {
  step: TutorialStep;
  position: { n: number; total: number };
  targets: RefObject<Map<TutorialTarget, Set<RefObject<View | null>>>>;
  onPrimary: () => void;
  onSkip: () => void;
  onMissing: () => void;
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

  // Follows the control as it moves — a scroll, a page turn, the keyboard — and gives up on
  // a control that never appears, so a missing one can't strand the tour.
  useEffect(() => {
    if (!step.target) return;
    const target = step.target;
    const began = Date.now();
    let found = false;
    const measure = () => {
      const refs = [...(targets.current?.get(target) ?? [])];
      let best: Rect | null = null;
      let pending = refs.length;
      const done = () => {
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
    measure();
    const timer = setInterval(measure, MEASURE_MS);
    return () => clearInterval(timer);
  }, [step, targets, window.width, window.height]);

  // Padded, but kept on screen: a full-width row would otherwise lose its outline's sides.
  const hole = rect ? inside({ x: rect.x - PAD, y: rect.y - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }, window) : null;
  // A scroll step waits on the page, undimmed and untouched, until its section comes into view.
  const scrolling = step.action === 'scrollDown' && !hole;
  // Touches reach the control under the cut-out only when the step asks for a movement there.
  const passThrough = step.action === 'swipeLeft' || step.action === 'tap';
  const title = step.arrived && hole ? step.arrived.title : step.title;
  const body = step.arrived && hole ? step.arrived.body : step.body;

  // The card goes on the roomier side of the cut-out, with the arrow between; a cut-out with
  // no room either side (the whole week grid) has the card along its foot.
  const ARROW = 28;
  const MARGIN = Space.l;
  const cardWidth = Math.min(window.width - MARGIN * 2, 380);
  const cardLeft = (window.width - cardWidth) / 2;
  let cardTop: number;
  let arrow: { top: number; left: number; up: boolean } | null = null;
  if (!hole) {
    cardTop = scrolling ? window.height * 0.12 : (window.height - cardHeight) / 2;
  } else {
    const above = hole.y;
    const below = window.height - (hole.y + hole.height);
    const centreX = Math.min(Math.max(hole.x + hole.width / 2, MARGIN + ARROW / 2), window.width - MARGIN - ARROW / 2);
    if (below >= cardHeight + ARROW + MARGIN && below >= above) {
      cardTop = hole.y + hole.height + ARROW;
      arrow = { top: hole.y + hole.height + 2, left: centreX - ARROW / 2, up: true };
    } else if (above >= cardHeight + ARROW + MARGIN) {
      cardTop = hole.y - ARROW - cardHeight;
      arrow = { top: hole.y - ARROW - 2, left: centreX - ARROW / 2, up: false };
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
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: scrolling ? 'rgba(0, 0, 0, 0.25)' : dim }]} />
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
      {scrolling ? null : hole ? (
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

      {arrow ? (
        <View pointerEvents="none" style={{ position: 'absolute', top: arrow.top, left: arrow.left }}>
          <Icon name={arrow.up ? 'arrowUp' : 'arrowDown'} size={ARROW} color={theme.accent} />
        </View>
      ) : null}
      {step.action && (hole || scrolling) && !(step.arrived && hole) ? (
        <Gesture action={step.action} hole={hole} window={window} />
      ) : null}

      <View
        accessibilityViewIsModal
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
          <Pressable
            onPress={onPrimary}
            accessibilityRole="button"
            style={({ pressed }) => [styles.primary, { backgroundColor: theme.accent }, pressed && styles.pressed]}
          >
            <Txt type="subheadline" color={theme.canvas} style={styles.semibold}>{step.primary}</Txt>
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

/** Wide enough to reach every edge of any screen from the cut-out. */
const BORDER = 3000;

function Blocker({ style }: { style: object }) {
  return <View style={[styles.blocker, style]} importantForAccessibility="no" accessibilityElementsHidden />;
}

/**
 * The movement to make, shown by a hand making it: across the cut-out for a swipe, pressing
 * it for a tap, up the screen for a scroll. Under Reduce Motion, an arrow that holds still.
 */
function Gesture({ action, hole, window }: {
  action: NonNullable<TutorialStep['action']>;
  hole: Rect | null;
  window: { width: number; height: number };
}) {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();
  const [t] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(Animated.timing(t, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [t, reduceMotion]);

  const SIZE = 36;
  const area = hole ?? { x: 0, y: 0, width: window.width, height: window.height };
  const cx = area.x + area.width / 2 - SIZE / 2;
  const cy = area.y + area.height / 2 - SIZE / 2;
  const fadeInOut = t.interpolate({ inputRange: [0, 0.15, 0.8, 1], outputRange: [0, 1, 1, 0] });
  const scrolls = action === 'scrollDown';
  // A scroll's hand goes up the middle of the screen; the others work on the cut-out.
  const left = scrolls ? window.width / 2 - SIZE / 2 : cx;
  const top = scrolls ? window.height * 0.62 : cy;
  const span = Math.min(area.width * 0.3, 120);
  const transform =
    action === 'swipeLeft' ? [{ translateX: t.interpolate({ inputRange: [0, 1], outputRange: [span, -span] }) }]
      : scrolls ? [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -window.height * 0.22] }) }]
        : [{ scale: t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.8, 1] }) }];
  const icon = reduceMotion ? (action === 'swipeLeft' ? 'arrowLeft' : action === 'scrollDown' ? 'arrowUp' : 'hand') : 'hand';
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', left, top, opacity: reduceMotion ? 1 : action === 'tap' ? 1 : fadeInOut, transform: reduceMotion ? [] : transform }}
    >
      <View style={[styles.hand, { backgroundColor: theme.surface, borderColor: theme.accent }]}>
        <Icon name={icon} size={22} color={theme.accent} />
      </View>
    </Animated.View>
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
  hand: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
