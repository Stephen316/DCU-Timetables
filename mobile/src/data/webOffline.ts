import { Platform } from 'react-native';
import { webAppRoot, WebUpdate } from './webUpdate';

/**
 * Installs the offline copy (public/sw.js), so the web build opens with no connection once
 * it has opened with one. The first visit runs on the network as any page does; the copy is
 * saved in the background after. Only for a real build: in development there's nothing fixed to
 * keep, and a copy would serve yesterday's code over the dev server's. The Mac app's web view
 * has no service workers, and there it simply doesn't install.
 */
export function registerOfflineCopy(): void {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (WebUpdate.entryScript(document.documentElement.innerHTML) === null) return;
  const root = webAppRoot();
  const register = () => void navigator.serviceWorker.register(`${root}sw.js`, { scope: root }).catch(() => undefined);
  // Not until the page has loaded and gone quiet: on a first visit, saving the copy would
  // otherwise download alongside sign-in and the timetable, and on a weak signal hold them up.
  const whenQuiet = () => setTimeout(() => (window.requestIdleCallback ? window.requestIdleCallback(register, { timeout: 10_000 }) : register()), 5_000);
  if (document.readyState === 'complete') whenQuiet();
  else window.addEventListener('load', whenQuiet, { once: true });
}
