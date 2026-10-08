import { AppState, Platform } from 'react-native';

/**
 * Keeps the web build current once it's on the Home Screen. iOS resumes a Home Screen app
 * rather than reloading it, and it has no reload button, so a student could run last week's
 * build for days. Each export names its code file after its contents
 * (`_expo/static/js/web/entry-<hash>.js`), so a different name in the live page means a new
 * build is up.
 */
export const WebUpdate = {
  /** The built code file a page loads. Null in development, where nothing is built. */
  entryScript(html: string): string | null {
    return /_expo\/static\/js\/web\/entry-[0-9a-f]+\.js/.exec(html)?.[0] ?? null;
  },

  /**
   * Reload when the live page names a different build — unless this page already reloaded
   * for that one and still came back old (a cache that hasn't caught up), which would loop.
   */
  shouldReload(running: string | null, live: string | null, alreadyTried: string | null): boolean {
    return running !== null && live !== null && live !== running && live !== alreadyTried;
  },
};

const TRIED_KEY = 'webUpdate:tried';

/**
 * Checks at launch and each time the app comes back to the front — the moment a student has
 * just opened it, before they're part-way through anything — and reloads onto a newer build.
 * Not while they're typing: a half-written deadline is worth more than a minute's lag.
 */
export function startWebUpdateChecks(): () => void {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return () => undefined;
  const running = WebUpdate.entryScript(document.documentElement.innerHTML);
  if (running === null) return () => undefined;

  const check = async () => {
    const typing = document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA';
    if (typing) return;
    try {
      // The app's root, where the manifest is: the router moves the URL off it.
      const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.href;
      const root = manifest ? new URL('.', manifest).href : location.origin + '/';
      const response = await fetch(root, { cache: 'no-store' });
      if (!response.ok) return;
      const live = WebUpdate.entryScript(await response.text());
      if (!WebUpdate.shouldReload(running, live, sessionStorage.getItem(TRIED_KEY))) return;
      sessionStorage.setItem(TRIED_KEY, live!);
      // The root, not a reload: Pages has only the one page, and a reload at /app/class/…
      // would get its 404. The app opens on today, as it does coming back anyway.
      location.replace(root);
    } catch {
      // Offline, or storage refused: try again next time it's opened.
    }
  };

  void check();
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') void check();
  });
  return () => subscription.remove();
}
