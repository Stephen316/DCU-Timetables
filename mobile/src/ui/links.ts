/**
 * The public pages App Review and the App Store listing point at: `site/` in this repository,
 * served at dculive.ie. Change them here and in App Store Connect together.
 */
const BASE = 'https://dculive.ie';

export const AppLinks = {
  privacy: `${BASE}/privacy.html`,
  terms: `${BASE}/terms.html`,
  support: `${BASE}/support.html`,
} as const;
