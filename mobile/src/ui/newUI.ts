import { Platform } from 'react-native';
import { MacShell } from '../data/macShell';

/**
 * The bencho.dev-inspired UI is on the web build only — in a phone's browser or on a desktop
 * one — for now. The native iOS app and the Mac app (this same web build in a native window,
 * which `MacShell` recognises) keep the original look until it's rolled out to them.
 *
 * One switch, read wherever the two looks differ, so turning it on elsewhere later is a
 * change to this function and nothing else.
 */
export function isNewUI(): boolean {
  return Platform.OS === 'web' && !MacShell.isPresent();
}
