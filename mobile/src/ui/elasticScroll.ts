import { Ref, RefCallback } from 'react';
import { Platform, ScrollView } from 'react-native';

/** The furthest past its end a page can be pulled, however hard it's pushed: a hint, not a stretch. */
const MAX_PULL = 60;
/** How much of a push shows at first, before the resistance builds: a little, so it eases out. */
const GIVE = 0.35;
/** A pull springs back after this long at most, even with the wheel or trackpad still going. */
const HOLD_MS = 60;
/**
 * Once it's sprung back, the scroll that pulled it is spent: a trackpad's momentum keeps
 * sending it for a while after the fingers lift, and it mustn't pull the page out again.
 * Only a pause this long in the scrolling starts a fresh pull.
 */
const SPENT_MS = 180;
/** Out to a pull: eased, so the page glides there rather than jumping a step per wheel tick. */
const PULL = 'transform 90ms cubic-bezier(0.33, 1, 0.68, 1)';
/** Back from it: a soft ease-out, quick to start and gentle to land. */
const SPRING = 'transform 240ms cubic-bezier(0.22, 1, 0.36, 1)';

/**
 * The pull a push past the end shows: it gives a little at first and ever less after, the
 * curve iOS rubber-bands with, but capped short, so the page only nudges past its edge.
 */
function stretched(push: number): number {
  return Math.sign(push) * (1 - 1 / ((Math.abs(push) * GIVE) / MAX_PULL + 1)) * MAX_PULL;
}

/**
 * Rubber banding for a scroll view in the browser. A phone app's scroll views bounce at their
 * ends, even with nothing to scroll; a browser's bounce only where there is something to
 * scroll (iPhone Safari under a finger), or not at all (a desktop trackpad or wheel). Here,
 * a finger, trackpad or wheel taken on past either end pulls the page after it with growing
 * resistance, and when it lets go the page springs back — on every page, whether it scrolls
 * or not.
 */
function attach(node: HTMLElement): () => void {
  let push = 0;
  let settle: ReturnType<typeof setTimeout> | null = null;
  /** A finger on the page: where it went down, which way it's moving, and where a pull began. */
  let touch: { x: number; y: number; last: number; axis: 'v' | 'h' | null; from: number | null } | null = null;

  const content = () => node.firstElementChild as HTMLElement | null;
  /** Under a finger the page follows it exactly; a wheel's pull eases out; letting go springs back. */
  const show = (motion: 'follow' | 'pull' | 'spring') => {
    const el = content();
    if (!el) return;
    el.style.transition = motion === 'spring' ? SPRING : motion === 'pull' ? PULL : 'none';
    el.style.transform = push === 0 ? '' : `translateY(${stretched(push).toFixed(1)}px)`;
  };
  /** Until when the wheel's scroll at an end is spent momentum, and pulls nothing. */
  let spentUntil = 0;
  const springBack = () => {
    settle = null;
    push = 0;
    spentUntil = performance.now() + SPENT_MS;
    show('spring');
  };

  const onWheel = (e: WheelEvent) => {
    // A pinch is a zoom, and a sideways swipe is the pager's.
    if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * node.clientHeight : e.deltaY;
    if (dy === 0) return;
    const end = node.scrollHeight - node.clientHeight;
    if (push === 0) {
      // Past the top, the page comes down (a positive pull); past the bottom, it goes up.
      const pastTop = dy < 0 && node.scrollTop <= 0;
      const pastEnd = dy > 0 && node.scrollTop >= end - 1;
      if (!pastTop && !pastEnd) return;
      const now = performance.now();
      if (now < spentUntil) {
        // The tail of the scroll that already bounced: hold the page still till it dies away.
        spentUntil = now + SPENT_MS;
        e.preventDefault();
        return;
      }
      push = -dy;
      // Back in a moment, however long the scroll keeps coming.
      settle = setTimeout(springBack, HOLD_MS);
    } else {
      const was = push;
      push -= dy;
      // Scrolled back the other way past where it started: that's ordinary scrolling again.
      if (Math.sign(push) !== Math.sign(was)) {
        push = 0;
        if (settle) clearTimeout(settle);
        settle = null;
      }
    }
    e.preventDefault();
    show('pull');
  };

  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) {
      touch = null;
      return;
    }
    if (settle) clearTimeout(settle);
    settle = null;
    const { clientX, clientY } = e.touches[0];
    touch = { x: clientX, y: clientY, last: clientY, axis: null, from: null };
  };

  const onTouchMove = (e: TouchEvent) => {
    if (!touch || e.touches.length !== 1) return;
    const { clientX, clientY } = e.touches[0];
    if (touch.axis === null) {
      const dx = clientX - touch.x;
      const dy = clientY - touch.y;
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      // A sideways drag is the pager's, and is left to it.
      touch.axis = Math.abs(dy) > Math.abs(dx) ? 'v' : 'h';
    }
    if (touch.axis !== 'v') return;
    const down = clientY > touch.last;
    touch.last = clientY;
    if (touch.from === null) {
      const end = node.scrollHeight - node.clientHeight;
      // Not at the end it's being dragged past: that's ordinary scrolling. Nor, once the
      // browser has the page scrolling under the finger, can it be taken from it: it bounces
      // that one itself.
      if ((down ? node.scrollTop > 0 : node.scrollTop < end - 1) || !e.cancelable) return;
      touch.from = clientY;
    }
    const pull = clientY - touch.from;
    if (push !== 0 && Math.sign(pull) !== Math.sign(push)) {
      // Pushed back past where the pull began.
      push = 0;
      touch.from = null;
      show('follow');
      return;
    }
    e.preventDefault();
    push = pull;
    show('follow');
  };

  const onTouchEnd = () => {
    if (touch?.from != null || push !== 0) springBack();
    touch = null;
  };

  node.addEventListener('wheel', onWheel, { passive: false });
  node.addEventListener('touchstart', onTouchStart, { passive: true });
  node.addEventListener('touchmove', onTouchMove, { passive: false });
  node.addEventListener('touchend', onTouchEnd);
  node.addEventListener('touchcancel', onTouchEnd);
  return () => {
    node.removeEventListener('wheel', onWheel);
    node.removeEventListener('touchstart', onTouchStart);
    node.removeEventListener('touchmove', onTouchMove);
    node.removeEventListener('touchend', onTouchEnd);
    node.removeEventListener('touchcancel', onTouchEnd);
    if (settle) clearTimeout(settle);
    const el = content();
    if (el) el.style.transform = '';
  };
}

/** The scrolling element behind a React Native Web scroll view's ref. */
function scrollNode(view: ScrollView): HTMLElement | null {
  const node = view as unknown as { getScrollableNode?: () => HTMLElement | null } & HTMLElement;
  return typeof node.getScrollableNode === 'function' ? node.getScrollableNode() : node instanceof HTMLElement ? node : null;
}

/**
 * A ref for a ScrollView that rubber-bands it in the browser (and does nothing in the phone
 * app, where scroll views bounce already). `also` is a ref the caller wants the view in too.
 */
export function elasticScroll(also?: Ref<ScrollView>): RefCallback<ScrollView> {
  return (view) => {
    if (typeof also === 'function') also(view);
    else if (also) (also as { current: ScrollView | null }).current = view;
    const node = Platform.OS === 'web' && view ? scrollNode(view) : null;
    const detach = node ? attach(node) : null;
    return () => {
      detach?.();
      if (typeof also === 'function') also(null);
      else if (also) (also as { current: ScrollView | null }).current = null;
    };
  };
}
