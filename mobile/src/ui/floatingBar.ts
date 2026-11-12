import { Platform, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MacShell } from '../data/macShell';
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
  /** The narrowest window that gets the rail; below this it's a phone's bottom bar. */
  minWindow: 600,
  /** A browser window shorter than this is a phone on its side, which keeps the bottom bar. */
  minWebHeight: 480,
  /**
   * The narrowest window whose week is centred in the whole window, the rail's room matched on
   * the left; below it the grid needs that room more than it needs to look centred.
   */
  minBalanced: Desktop.wide + (FloatingBar.height + Space.l * 2) * 2,
} as const;

/**
 * What the week screen keeps clear on its left, beside the rail's room on its right, so the
 * grid sits as centred as it would with no rail at all. Nothing on a window too narrow to spare it.
 */
export function useRailBalance(): number {
  const { width } = useWindowDimensions();
  return useDesktopRail() && width >= DesktopRail.minBalanced ? DesktopRail.width : 0;
}

/**
 * Whether the tabs stand down the right edge rather than along the bottom: on any big screen —
 * a laptop or PC browser, or a tablet either way up — but never a phone, even turned sideways.
 * In the app, a tablet is a screen whose shorter side is past a phone's; in a browser, it's a
 * window wide enough and not as short as a sideways phone's.
 */
export function useDesktopRail(): boolean {
  const { width, height } = useWindowDimensions();
  if (Platform.OS === 'web') return width >= DesktopRail.minWindow && height >= DesktopRail.minWebHeight;
  return Math.min(width, height) >= DesktopRail.minWindow;
}

/**
 * The week is the front page and there is no Today tab: on the Mac, and on a desktop-wide
 * window, which has the room for the whole week. A phone keeps Today, its day list.
 */
export function useWeekFirst(): boolean {
  const rail = useDesktopRail();
  return rail || MacShell.isPresent();
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
