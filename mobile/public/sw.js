// The web build's offline copy. iOS gives a Home Screen app no copy of its own, so once it
// has been dropped from memory, opening it offline shows Safari's error page. This keeps the
// page, the code and the assets it names, so the app opens — and the timetable it saved, in
// localStorage, shows — with no connection.
//
// The page always comes from the network when there is one, so a deploy is never held back.
// The code and assets are named after their contents (entry-<hash>.js), so a saved copy of
// one never goes stale and is only replaced when a build names a different file.
//
// Copied as-is into the export by Expo (public/), and registered by src/data/webOffline.ts.

const CACHE = 'dcu-timetable-app';
const ROOT = new URL(self.registration.scope);
const PAGE = ROOT.href;
const BUILT = /^(_expo\/static\/|assets\/)/;

/**
 * Everything a page needs to start: its code file and the files that names. The code comes
 * from the copy when it's there — only a new build downloads it.
 */
async function filesFor(pageText, cache) {
  const entry = /_expo\/static\/js\/web\/entry-[0-9a-f]+\.js/.exec(pageText)?.[0];
  if (!entry) return null;
  const url = new URL(entry, ROOT).href;
  const code = (await cache.match(url)) ?? (await fetch(url));
  if (!code.ok) return null;
  const codeText = await code.clone().text();
  // The code names its other files by full path: the lazily loaded chunks and every asset.
  const named = new RegExp(`"${ROOT.pathname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}((?:_expo/static/js/web/|assets/)[^"]+)"`, 'g');
  const paths = new Set([...codeText.matchAll(named)].map((m) => m[1]));
  return { entry, code, paths: [...paths] };
}

/**
 * Saves a page and what it needs, then drops the files of builds before it. The page goes in
 * last, so the copy never names a code file it doesn't have.
 */
async function save(pageResponse) {
  const cache = await caches.open(CACHE);
  const pageText = await pageResponse.clone().text();
  const files = await filesFor(pageText, cache);
  if (!files) return;
  await cache.put(new URL(files.entry, ROOT).href, files.code);
  for (const path of [...files.paths, 'manifest.webmanifest', 'apple-touch-icon.png', 'icon-192.png', 'favicon.ico']) {
    const url = new URL(path, ROOT).href;
    if (await cache.match(url)) continue;
    const response = await fetch(url).catch(() => null);
    if (response?.ok) await cache.put(url, response);
  }
  await cache.put(PAGE, pageResponse);

  // Another build's code is never asked for again. Assets are kept: most outlive a build.
  const keep = new Set([files.entry, ...files.paths].map((p) => new URL(p, ROOT).href));
  for (const request of await cache.keys()) {
    if (request.url.startsWith(new URL('_expo/static/js/', ROOT).href) && !keep.has(request.url)) await cache.delete(request);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    fetch(PAGE, { cache: 'no-store' })
      .then((response) => (response.ok ? save(response) : undefined))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // Supabase and the DCU timetable API answer for themselves; only the app's own files are kept.
  if (request.method !== 'GET' || url.origin !== ROOT.origin || !url.href.startsWith(PAGE)) return;
  // The update check (src/data/webUpdate.ts) asks the network itself, past any copy.
  if (request.cache === 'no-store') return;

  if (request.mode === 'navigate') {
    event.respondWith(openPage(event));
    return;
  }
  const path = url.href.slice(PAGE.length);
  if (BUILT.test(path)) {
    event.respondWith(builtFile(request));
  }
});

/**
 * The network's page when it answers, saved for next time; the saved one when it doesn't.
 * Pages has only the one page, so a 404 for a page under the app (/app/class/…) gets it too.
 */
async function openPage(event) {
  try {
    const response = await fetch(event.request);
    if (response.ok && new URL(event.request.url).href === PAGE) {
      event.waitUntil(save(response.clone()).catch(() => undefined));
      return response;
    }
    if (response.status !== 404) return response;
  } catch {
    // Offline: the saved page below.
  }
  return (await caches.match(PAGE)) ?? Response.error();
}

/** A file named after its contents never changes, so a saved copy is as good as a fresh one. */
async function builtFile(request) {
  const saved = await caches.match(request);
  if (saved) return saved;
  const response = await fetch(request);
  if (response.ok) {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
  }
  return response;
}
