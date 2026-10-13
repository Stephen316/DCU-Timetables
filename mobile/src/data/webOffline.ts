import { Platform } from 'react-native';
import { webAppRoot, WebUpdate } from './webUpdate';

/**
 * Installs the offline copy (public/sw.js), so the web build opens with no connection once
 * it has opened with one. Only for a real build: in development there's nothing fixed to
 * keep, and a copy would serve yesterday's code over the dev server's. The Mac app's web view
 * has no service workers, and there it simply doesn't install.
 */
export function registerOfflineCopy(): void {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (WebUpdate.entryScript(document.documentElement.innerHTML) === null) return;
  const root = webAppRoot();
  navigator.serviceWorker.register(`${root}sw.js`, { scope: root }).catch(() => undefined);
}
