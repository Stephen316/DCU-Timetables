import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Space } from './theme';

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
 * What the bar and its haze cover at the foot of the screen: pad a list's end by this, so
 * scrolled all the way down, its last line rests clear of the fade rather than dissolving in it.
 */
export function useTabBarClearance(): number {
  const { bottom } = useSafeAreaInsets();
  return FloatingBar.height + floatingBarMargin(bottom) + FloatingBar.fade;
}
