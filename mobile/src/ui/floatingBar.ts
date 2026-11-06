import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MIN_TARGET, Space } from './theme';

/**
 * The tab bar floats over the screens rather than taking a strip off the bottom of them, so
 * every list under it has to know how much of its end the bar covers. The sizes live here,
 * where both the bar and what scrolls beneath it can read them.
 */
export const FloatingBar = {
  /** Between the pill's edge and the tabs inside it. */
  padding: Space.xs,
  /** A tab is a full touch target; the pill wraps it. */
  height: MIN_TARGET + Space.xs * 2,
} as const;

/**
 * How far the pill sits above the screen's bottom edge: tucked just above the home
 * indicator on a Face ID phone (the indicator's inset is more than the pill needs), and a
 * small gap off the edge anywhere else.
 */
export function floatingBarMargin(bottomInset: number): number {
  return Math.max(bottomInset - Space.s, Space.s);
}

/** What the bar covers at the foot of the screen, plus room to breathe: pad a list's end by this. */
export function useTabBarClearance(): number {
  const { bottom } = useSafeAreaInsets();
  return FloatingBar.height + floatingBarMargin(bottom) + Space.l;
}
