import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform as RNPlatform } from 'react-native';
import { ExpoAlertScheduler } from './notifications';
import { Handovers, HANDOVER_PREFS, WEB_SESSION_KEY } from './handover';
import { MacShell } from './macShell';
import { createPreviewServices } from './preview';
import { createServices, Services } from './services';
import { SecretStore } from './session';
import { AsyncKV } from './storage';

/**
 * The student's Supabase tokens, in the Keychain (iOS) or Keystore (Android): a token is a
 * bearer credential, so it doesn't belong in AsyncStorage. Device-only — a session restored
 * onto another phone from a backup would be a sign-in the student never performed.
 */
const keychain: SecretStore = {
  get: (key) => SecureStore.getItemAsync(key, { keychainService: 'ie.dcu.timetable.auth' }),
  set: (key, value) =>
    SecureStore.setItemAsync(key, value, {
      keychainService: 'ie.dcu.timetable.auth',
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    }),
  remove: (key) => SecureStore.deleteItemAsync(key, { keychainService: 'ie.dcu.timetable.auth' }),
};

/** The web build has no Keychain, so the session is in localStorage (and `HandoverCookie`). */
const webSecrets: SecretStore = {
  get: (key) => AsyncStorage.getItem(`secret:${key}`),
  set: (key, value) => AsyncStorage.setItem(`secret:${key}`, value),
  remove: (key) => AsyncStorage.removeItem(`secret:${key}`),
};

/**
 * Read by name: Expo inlines `process.env.EXPO_PUBLIC_*` into the bundle at build time only
 * where each one is written out in full, so the object can't be passed along whole.
 */
function env(): Record<string, string | undefined> {
  return {
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    EXPO_PUBLIC_DCU_API_BASE: process.env.EXPO_PUBLIC_DCU_API_BASE,
  };
}

/**
 * `EXPO_PUBLIC_PREVIEW=1` opens the app on fixture data — a signed-in student with a week of
 * classes, reports and deadlines — so a screen can be checked without a network or account.
 */
export function isPreview(): boolean {
  return process.env.EXPO_PUBLIC_PREVIEW === '1';
}

export function createAppServices(): Promise<Services> {
  const kv = AsyncStorage as unknown as AsyncKV;
  if (isPreview()) return createPreviewServices(kv);
  if (RNPlatform.OS === 'web') return createWebServices(kv);
  return createServices({ kv, secrets: keychain, env: env(), alerts: new ExpoAlertScheduler() });
}

/**
 * The web build, kept signed in across Add to Home Screen: a sign-in handed over in the
 * cookie is restored before anything reads storage, and the cookie follows every change to
 * the session or to who is signed in. See `Handover`.
 */
async function createWebServices(kv: AsyncKV): Promise<Services> {
  try {
    await Handovers.restore(kv, Handovers.decode(HandoverCookie.read()));
  } catch {
    // Starts signed out, as it would have without the cookie.
  }
  let session = await kv.getItem(WEB_SESSION_KEY).catch(() => null);
  let services: Services | null = null;
  const publish = () => {
    if (!services) return;
    const handover = Handovers.from(session, services.prefs);
    HandoverCookie.write(handover ? Handovers.encode(handover) : null);
  };
  const secrets: SecretStore = {
    get: webSecrets.get,
    async set(key, value) {
      await webSecrets.set(key, value);
      if (`secret:${key}` === WEB_SESSION_KEY) {
        session = value;
        publish();
      }
    },
    async remove(key) {
      await webSecrets.remove(key);
      if (`secret:${key}` === WEB_SESSION_KEY) {
        session = null;
        publish();
      }
    },
  };
  // In the Mac app, class alerts go to the Mac; in a browser there's nothing to fire them.
  services = await createServices({ kv, secrets, env: env(), alerts: MacShell.alerts() ?? undefined });
  for (const key of HANDOVER_PREFS) services.prefs.subscribe(key, publish);
  publish();
  return services;
}

/**
 * The cookie itself. Scoped to the app's own folder, so the site pages beside it on GitHub
 * Pages never send it, and `SameSite=Strict` and `Secure` so it goes nowhere else. Safari
 * keeps a cookie set from script for at most 7 days, which is plenty: each refresh and each
 * launch writes it again.
 */
const HandoverCookie = {
  name: 'dcu_timetable_handover',

  /**
   * The app's root, where the manifest sits, without its trailing slash: "/DCU-Timetables/app"
   * covers the root however it's written and every page under it, and nothing beside it.
   */
  path(): string {
    const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.href;
    const folder = manifest ? new URL('.', manifest).pathname : '/';
    return folder.length > 1 ? folder.replace(/\/$/, '') : folder;
  },

  read(): string | null {
    if (typeof document === 'undefined') return null;
    const prefix = `${HandoverCookie.name}=`;
    return document.cookie.split('; ').find((c) => c.startsWith(prefix))?.slice(prefix.length) ?? null;
  },

  write(value: string | null): void {
    if (typeof document === 'undefined') return;
    const attributes = `Path=${HandoverCookie.path()}; Secure; SameSite=Strict`;
    document.cookie = value === null
      ? `${HandoverCookie.name}=; ${attributes}; Max-Age=0`
      : `${HandoverCookie.name}=${value}; ${attributes}; Max-Age=${400 * 86_400}`;
  },
};
