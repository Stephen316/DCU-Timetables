import { Platform } from 'react-native';

/**
 * Safari itself on an iPhone, with the app not yet on the Home Screen. Not Chrome, Edge or
 * Firefox on iOS, whose Share is elsewhere, nor an app's own browser (Instagram's, Gmail's),
 * which can't add to the Home Screen at all — and which, unlike Safari, leaves "Version/…
 * Safari/…" out of what it says it is.
 */
export const Safari = {
  isIPhoneSafari(userAgent: string): boolean {
    return /\biPhone\b/.test(userAgent)
      && /\bVersion\/[\d.]+\b.*\bSafari\//.test(userAgent)
      && !/\b(CriOS|FxiOS|EdgiOS|OPiOS|GSA)\//.test(userAgent);
  },

  /** Here and now: false in the native app, and on the Home Screen. */
  current(): boolean {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined') return false;
    if ((navigator as { standalone?: boolean }).standalone === true) return false;
    return Safari.isIPhoneSafari(navigator.userAgent);
  },
};
