import { CancellationRules } from './cancellation';
import { roomCodes } from './roomLocation';
import { DeadlineRules } from './deadline';
import { compactTitleOf, TimetableEvent } from './timetableEvent';

/**
 * Notifications for the web build, pushed by the server (supabase/phase37_web_push.sql)
 * since a web page can't schedule one of its own. The pure half: whether this browser can
 * have them, which kinds the student wants, and what the server is told to follow.
 */

/**
 * What the Notifications sheet offers:
 *   unsupported      this browser has no web push, or it's a development build
 *   addToHomeScreen  Safari on an iPhone, which only pushes to a Home Screen app
 *   ask              never asked: a button that asks
 *   denied           refused, which only Settings can undo
 *   granted          on: the kinds can be chosen
 */
export type PushAvailability = 'unsupported' | 'addToHomeScreen' | 'ask' | 'denied' | 'granted';

export interface PushEnvironment {
  serviceWorker: boolean;
  pushManager: boolean;
  notification: boolean;
  /** An iPhone or iPad, whatever the browser: they all push only from the Home Screen. */
  iOS: boolean;
  /** Opened from the Home Screen. */
  standalone: boolean;
  /** A real build, which has the service worker: a development server has nothing to push to. */
  built: boolean;
  permission: 'default' | 'granted' | 'denied';
}

export function pushAvailability(env: PushEnvironment): PushAvailability {
  // iOS hides PushManager from a page in a tab, so ask for the Home Screen before anything else.
  if (env.iOS && !env.standalone) return 'addToHomeScreen';
  if (!env.serviceWorker || !env.pushManager || !env.notification || !env.built) return 'unsupported';
  if (env.permission === 'granted') return 'granted';
  if (env.permission === 'denied') return 'denied';
  return 'ask';
}

/** Which notifications the student wants. All off until they turn notifications on. */
export interface PushKinds {
  classStatus: boolean;
  newDeadlines: boolean;
  /** A day before each deadline on the student's modules, and 3 hours before. */
  deadlineReminders: boolean;
  /** 15 minutes before each class, as the native app's default class alert. */
  classAlerts: boolean;
}

export const PushKindsRules = {
  off: { classStatus: false, newDeadlines: false, deadlineReminders: false, classAlerts: false } as PushKinds,
  /** What turning notifications on chooses: everything, since that's what the student asked for. */
  on: { classStatus: true, newDeadlines: true, deadlineReminders: true, classAlerts: true } as PushKinds,

  /**
   * Saved kinds, read defensively: anything unrecognised is off. Class alerts came later, so
   * a student who turned notifications on before them has them on unless they say otherwise.
   */
  read(saved: unknown): PushKinds {
    if (saved === null || typeof saved !== 'object') return PushKindsRules.off;
    const s = saved as Partial<Record<keyof PushKinds, unknown>>;
    return {
      classStatus: s.classStatus === true, newDeadlines: s.newDeadlines === true,
      deadlineReminders: s.deadlineReminders === true, classAlerts: s.classAlerts !== false,
    };
  },
};

/** What the server follows for this browser: the classes and modules it pushes about. */
export interface PushTargets {
  eventKeys: string[];
  moduleKeys: string[];
  /** What the app calls each module, so a notification names it the same way. */
  moduleNames: Record<string, string>;
  /** Deadlines the student has ticked off, which get no reminder. Ticks live on the phone. */
  doneDeadlines: string[];
  /**
   * Each followed class as its alert names it, since the server knows only its key: the
   * week grid's short name ("Fund. of Prof. Dev.") and its rooms as codes ("SA301").
   */
  eventDetails: Record<string, { title: string; room: string }>;
}

export const PushTargetsRules = {
  /** Caps the server enforces (save_push_subscription); kept under, soonest classes first. */
  maxEvents: 300,
  maxModules: 60,
  maxDone: 300,

  /** From the loaded weeks: classes not yet over, and every module they belong to. */
  from(events: TimetableEvent[], moduleNames: Map<string, string>, now: Date): PushTargets {
    const ahead = events.filter((e) => e.end > now).sort((a, b) => a.start.getTime() - b.start.getTime());
    const eventKeys = [...new Set(ahead.map((e) => CancellationRules.eventKey(e)))].slice(0, PushTargetsRules.maxEvents);
    const moduleKeys = [...new Set(events.map((e) => DeadlineRules.moduleKey(e)))].sort().slice(0, PushTargetsRules.maxModules);
    const names: Record<string, string> = {};
    for (const key of moduleKeys) {
      const name = moduleNames.get(key);
      if (name) names[key] = name;
    }
    const followed = new Set(eventKeys);
    const eventDetails: PushTargets['eventDetails'] = {};
    for (const e of ahead) {
      const key = CancellationRules.eventKey(e);
      if (followed.has(key) && !eventDetails[key]) eventDetails[key] = { title: compactTitleOf(e), room: roomCodes(e) };
    }
    return { eventKeys, moduleKeys, moduleNames: names, doneDeadlines: [], eventDetails };
  },

  /** What was last sent, to send again only on a change. Order-insensitive for event keys. */
  signature(endpoint: string, kinds: PushKinds, targets: PushTargets): string {
    return JSON.stringify([endpoint, kinds, [...targets.eventKeys].sort(), targets.moduleKeys, targets.moduleNames, targets.doneDeadlines, targets.eventDetails]);
  },
};

/** The VAPID public key, base64url as `web-push generate-vapid-keys` prints it, as the bytes `subscribe` wants. */
export function vapidKeyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Whether a subscription was made with this key (`PushSubscription.options.applicationServerKey`).
 * A browser that can't say is given the benefit of the doubt: dropping a good subscription
 * would cost more than keeping a stale one, which the server deletes once it's refused.
 */
export function sameVapidKey(subscribedWith: ArrayBuffer | null | undefined, base64url: string): boolean {
  if (!subscribedWith) return true;
  const want = vapidKeyBytes(base64url);
  const have = new Uint8Array(subscribedWith);
  return have.length === want.length && have.every((b, i) => b === want[i]);
}
