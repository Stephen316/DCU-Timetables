import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Desktop, Space } from './theme';

/** The selected tab's violet disc, and the pale ring round it. */
const DISC = 40;
const HALO = 56;

/**
 * The tab bar floats over the screens rather than taking a strip off the bottom of them, so
 * every list under it has to know how much of its end the bar covers. The sizes live here,
 * where both the bar and what scrolls beneath it can read them.
 */
export const FloatingBar = {
  disc: DISC,
  halo: HALO,
  /** Between the pill's edge and the halo, which is the tallest thing inside it. */
  padding: Space.s,
  /** The halo with the padding either side; a tab is the halo's height, past a full touch target. */
  height: HALO + Space.s * 2,
  /** How far above the pill the screen fades into the haze behind it. */
  fade: 64,
} as const;

/**
 * How far the pill sits above the screen's bottom edge: tucked just above the home
 * indicator on a Face ID phone (the indicator's inset is more than the pill needs), and a
 * small gap off the edge anywhere else.
 */
export function floatingBarMargin(bottomInset: number): number {
  return Math.max(bottomInset - Space.s, Space.s);
}

/**
 * On a desktop-wide window the tabs leave the foot of the screen and stand in a column down
 * its right edge: the same pill on end, with the room it needs kept clear beside the screens.
 */
export const DesktopRail = {
  /** The pill's width, and its gap from the window's edge. */
  pill: FloatingBar.height,
  margin: Space.l,
  /** What the screens give up on the right: the pill, its margin, and a gap before it. */
  width: FloatingBar.height + Space.l * 2,
} as const;

/** Whether the tabs stand down the right edge rather than along the bottom. */
export function useDesktopRail(): boolean {
  return useWindowDimensions().width >= Desktop.wide;
}

/**
 * What the bar and its haze cover at the foot of the screen: pad a list's end by this, so
 * scrolled all the way down, its last line rests clear of the fade rather than dissolving in it.
 * With the tabs on the right, nothing covers the foot, so only a little breathing room.
 */
export function useTabBarClearance(): number {
  const { bottom } = useSafeAreaInsets();
  const rail = useDesktopRail();
  if (rail) return Space.l + bottom;
  return FloatingBar.height + floatingBarMargin(bottom) + FloatingBar.fade;
}
