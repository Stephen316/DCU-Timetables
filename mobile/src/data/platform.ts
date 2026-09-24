import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform as RNPlatform } from 'react-native';
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

/** The web build has no Keychain. It is a development convenience, not a shipped target. */
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
  return createServices({ kv, secrets: RNPlatform.OS === 'web' ? webSecrets : keychain, env: env() });
}
