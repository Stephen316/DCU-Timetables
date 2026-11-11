/**
 * Rubber banding in the browser.
 *
 * Where the browser already bounces a list past its ends — every browser on a Mac, iPhone or
 * iPad, and Android's stretch — it's left to do so, the way a phone's own scroll views do.
 * Elsewhere (Windows and Linux, in any browser) the app bounces the lists itself, with the
 * same curve and spring back an iPhone uses, under a wheel, a trackpad or a finger. Either way
 * a list at its end never hands the scroll on to whatever is behind it, and the page itself
 * never moves: dragged past its edge it would pull the whole app, tab bar and all, and a
 * sideways swipe would go back a page in the browser's history.
 */

/** How stiff the pull past an end is: the constant UIScrollView rubber-bands with. */
const RESISTANCE = 0.55;
/** A wheel or trackpad quiet this long has let go, and the list springs back. */
const RELEASE_MS = 120;
/** Each wheel step eases out to its pull rather than jumping there. */
const GLIDE = 'transform 90ms ease-out';
/** Back from a pull: quick to start, gentle to land, as an iPhone's list settles. */
const SETTLE_MS = 450;
const SETTLE = `transform ${SETTLE_MS}ms cubic-bezier(0.23, 1, 0.32, 1)`;

/** How far a push past the end shows: a lot at first, ever less after, never the whole view. */
function stretched(push: number, size: number): number {
  return Math.sign(push) * (1 - 1 / ((Math.abs(push) * RESISTANCE) / size + 1)) * size;
}

/** The push that shows as `offset` — to carry on from a spring back still under way. */
function pushFor(offset: number, size: number): number {
  const shown = Math.min(Math.abs(offset), size * 0.99);
  return (Math.sign(offset) * (size / RESISTANCE) * (1 / (1 - shown / size) - 1)) || 0;
}

/** Whether this browser bounces lists past their ends by itself. */
function browserBounces(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = `${nav.userAgentData?.platform ?? ''} ${nav.platform ?? ''} ${nav.userAgent}`;
  return /Mac|iPhone|iPad|iPod|Android/i.test(platform);
}

/**
 * The list a scroll or touch on `target` would move: the nearest box that scrolls up and down.
 * A wheel picker (scroll-snapped) isn't bounced, and nor is anything round it.
 */
function listFor(target: EventTarget | null): HTMLElement | null {
  for (let el = target instanceof Element ? target : null; el && el !== document.body; el = el.parentElement) {
    if (!(el instanceof HTMLElement)) continue;
    const style = getComputedStyle(el);
    if (style.overflowY !== 'auto' && style.overflowY !== 'scroll') continue;
    return style.scrollSnapType === 'none' || style.scrollSnapType === '' ? el : null;
  }
  return null;
}

/** What moves when a list is pulled: its one content box (a ScrollView's content container). */
function contentOf(list: HTMLElement): HTMLElement | null {
  return list.children.length === 1 ? (list.firstElementChild as HTMLElement) : null;
}

/** Whether a list is at the end a scroll of `dy` would take it past. */
function atEnd(list: HTMLElement, dy: number): boolean {
  return dy < 0 ? list.scrollTop <= 0 : list.scrollTop >= list.scrollHeight - list.clientHeight - 1;
}

type Pull = { list: HTMLElement; content: HTMLElement; push: number; by: 'wheel' | 'touch' };

function bounceLists(): () => void {
  /** The list pulled past its end now, if one is. Positive is down, past the top. */
  let pull: Pull | null = null;
  let release: ReturnType<typeof setTimeout> | undefined;
  /** A finger on the page: where it went down, which way it's going, and where a pull began. */
  let touch: { list: HTMLElement; x: number; y: number; axis: 'v' | 'h' | null; from: number | null; base: number; dir: 1 | -1 } | null = null;

  const show = (motion: 'follow' | 'glide' | 'settle') => {
    if (!pull) return;
    const { content, list, push } = pull;
    content.style.transition = motion === 'follow' ? 'none' : motion === 'glide' ? GLIDE : SETTLE;
    content.style.transform = `translateY(${stretched(push, list.clientHeight).toFixed(1)}px)`;
  };

  /** Starts pulling `list`, picking up where a spring back still under way has got to. */
  const begin = (list: HTMLElement, by: Pull['by']): Pull | null => {
    const content = contentOf(list);
    if (!content) return null;
    const offset = new DOMMatrixReadOnly(getComputedStyle(content).transform).m42;
    return { list, content, push: pushFor(offset, list.clientHeight), by };
  };

  /** Lets go: the list springs back, and is left as it was once it's home. */
  const settle = () => {
    clearTimeout(release);
    if (!pull) return;
    pull.push = 0;
    show('settle');
    const { content } = pull;
    pull = null;
    const home = () => {
      content.removeEventListener('transitionend', home);
      clearTimeout(timer);
      if (pull?.content === content) return;
      content.style.transition = '';
      content.style.transform = '';
    };
    const timer = setTimeout(home, SETTLE_MS + 50);
    content.addEventListener('transitionend', home);
  };

  /**
   * Only watches the wheel, never holds it up: passive, so the browser scrolls on its own thread
   * and a busy moment in the app can't stall a scroll.
   */
  const onWheel = (e: WheelEvent) => {
    // A pinch is a zoom, and a sideways swipe is the pager's.
    if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) || pull?.by === 'touch') return;
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * window.innerHeight : e.deltaY;
    if (dy === 0) return;
    if (!pull) {
      const list = listFor(e.target);
      if (!list || !atEnd(list, dy)) return;
      pull = begin(list, 'wheel');
      if (!pull) return;
    }
    const before = pull.push;
    pull.push -= dy;
    // Scrolled back the way it came, past where the pull began: just a scroll again.
    if (before !== 0 && Math.sign(pull.push) !== Math.sign(before)) {
      settle();
      return;
    }
    show('glide');
    clearTimeout(release);
    release = setTimeout(settle, RELEASE_MS);
  };

  const onTouchStart = (e: TouchEvent) => {
    const list = e.touches.length === 1 ? listFor(e.target) : null;
    if (!list) {
      touch = null;
      return;
    }
    // A finger takes over from a wheel's pull.
    if (pull?.by === 'wheel') settle();
    const { clientX, clientY } = e.touches[0];
    touch = { list, x: clientX, y: clientY, axis: null, from: null, base: 0, dir: 1 };
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
      touch.y = clientY;
    }
    if (touch.axis !== 'v') return;
    if (touch.from === null) {
      // Ordinary scrolling till the list reaches the end it's dragged towards.
      const down = clientY > touch.y;
      const was = touch.y;
      touch.y = clientY;
      if (clientY === was || !e.cancelable || !atEnd(touch.list, down ? -1 : 1)) return;
      pull = begin(touch.list, 'touch');
      if (!pull) return;
      // From the last move, so this one already pulls.
      touch.from = was;
      touch.base = pull.push;
      touch.dir = down ? 1 : -1;
    }
    if (!pull) return;
    const push = touch.base + clientY - touch.from;
    if (push * touch.dir <= 0) {
      // Pushed back past where the pull began: the finger scrolls the list again.
      pull.push = 0;
      show('follow');
      pull = null;
      touch.from = null;
      touch.y = clientY;
      return;
    }
    e.preventDefault();
    pull.push = push;
    show('follow');
  };

  const onTouchEnd = () => {
    if (pull?.by === 'touch') settle();
    touch = null;
  };

  window.addEventListener('wheel', onWheel, { passive: true });
  window.addEventListener('touchstart', onTouchStart, { passive: true });
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('touchend', onTouchEnd);
  window.addEventListener('touchcancel', onTouchEnd);
  return () => {
    window.removeEventListener('wheel', onWheel);
    window.removeEventListener('touchstart', onTouchStart);
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('touchend', onTouchEnd);
    window.removeEventListener('touchcancel', onTouchEnd);
    settle();
  };
}

/**
 * Sets up rubber banding for the page; call once in the browser, and call what it returns to
 * take it down. In development `?rubberband` in the address forces the app's own bounce on, to
 * try it on a Mac.
 */
export function rubberBand(): () => void {
  const forced = __DEV__ && new URLSearchParams(window.location.search).has('rubberband');
  const own = forced || !browserBounces();
  const style = document.createElement('style');
  // The browser's own bounce stays on in the lists where it has one, and off where the app's
  // takes its place, so there's never two.
  style.textContent = `* { overscroll-behavior: ${own ? 'none' : 'contain'}; } html, body { overscroll-behavior: none; }`;
  document.head.appendChild(style);
  const detach = own ? bounceLists() : null;
  return () => {
    detach?.();
    style.remove();
  };
}
