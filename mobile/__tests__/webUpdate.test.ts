import { WebUpdate } from '../src/data/webUpdate';

const page = (hash: string) => `<script src="/DCU-Timetables/app/_expo/static/js/web/entry-${hash}.js" defer></script>`;
const running = '_expo/static/js/web/entry-1d29e1203514c1cd3e9846a61da0962a.js';
const newer = '_expo/static/js/web/entry-ffff00001111222233334444555566ab.js';

describe('Web build updates', () => {
  test("reads the build's code file from the page, and finds none in development", () => {
    expect(WebUpdate.entryScript(page('1d29e1203514c1cd3e9846a61da0962a'))).toBe(running);
    expect(WebUpdate.entryScript('<script src="/node_modules/expo-router/entry.bundle?platform=web"></script>')).toBeNull();
  });

  test('reloads onto a newer build, once', () => {
    expect(WebUpdate.shouldReload(running, newer, null)).toBe(true);
    expect(WebUpdate.shouldReload(running, running, null)).toBe(false);
    // Already reloaded for it and still old: a cache behind the deploy, so wait, don't loop.
    expect(WebUpdate.shouldReload(running, newer, newer)).toBe(false);
  });

  test('never reloads on a guess', () => {
    expect(WebUpdate.shouldReload(null, newer, null)).toBe(false);
    expect(WebUpdate.shouldReload(running, null, null)).toBe(false);
  });
});
