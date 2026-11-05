import { Platform } from 'react-native';
import {
  PushAvailability, pushAvailability, PushKinds, PushKindsRules, PushTargets, PushTargetsRules, sameVapidKey, vapidKeyBytes,
} from '../core/webPush';
import { notSignedIn, SupabaseREST } from './rest';
import { PrefKey, Prefs } from './storage';
import { WebUpdate, webAppRoot } from './webUpdate';

/** One browser's subscription as the server keeps it (`push_subscriptions`). */
export interface SavedPushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
  kinds: PushKinds;
  targets: PushTargets;
}

export interface PushSubscriptionStore {
  save(subscription: SavedPushSubscription): Promise<void>;
  /** Removes the server's copy of one of this account's subscriptions, by its endpoint. */
  delete(endpoint: string): Promise<void>;
}

export class SupabasePushSubscriptionStore implements PushSubscriptionStore {
  constructor(private readonly rest: SupabaseREST) {}

  async save(s: SavedPushSubscription): Promise<void> {
    if (!this.rest.session.userID) throw notSignedIn();
    await this.rest.json('POST', '/rest/v1/rpc/save_push_subscription', (status) => `The server returned ${status}.`, {
      body: {
        p_endpoint: s.endpoint, p_p256dh: s.p256dh, p_auth: s.auth,
        p_event_keys: s.targets.eventKeys, p_module_keys: s.targets.moduleKeys, p_module_names: s.targets.moduleNames,
        p_class_status: s.kinds.classStatus, p_new_deadlines: s.kinds.newDeadlines,
        p_deadline_reminders: s.kinds.deadlineReminders, p_done_deadlines: s.targets.doneDeadlines,
        p_class_alerts: s.kinds.classAlerts, p_event_details: s.targets.eventDetails,
      },
    });
  }

  async delete(endpoint: string): Promise<void> {
    if (!this.rest.session.userID) throw notSignedIn();
    await this.rest.json('POST', '/rest/v1/rpc/delete_push_subscription', (status) => `The server returned ${status}.`, {
      body: { p_endpoint: endpoint },
    });
  }
}

/**
 * Web push in the browser: asks, subscribes, and keeps the server's copy of what this
 * browser follows current. The timetable hands it its loaded weeks (`setTargets`) whenever
 * they change; the kinds come from the Notifications sheet, through prefs.
 */
export class WebPush {
  private targets: PushTargets | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: PushSubscriptionStore,
    private readonly prefs: Prefs,
    private readonly vapidKey: string | null,
  ) {
    prefs.subscribe(PrefKey.pushKinds, () => this.sync());
    // A deadline ticked off stops its reminders.
    prefs.subscribe(PrefKey.completedDeadlines, () => {
      if (this.targets) this.setTargets(this.targets);
    });
  }

  /** Read fresh each time: permission can change in Settings while the app is away. */
  availability(): PushAvailability {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined' || typeof window === 'undefined' || !this.vapidKey) return 'unsupported';
    const nav = navigator as Navigator & { standalone?: boolean };
    const iOS = /\b(iPhone|iPad|iPod)\b/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
    return pushAvailability({
      serviceWorker: 'serviceWorker' in nav,
      pushManager: 'PushManager' in window,
      notification: 'Notification' in window,
      iOS,
      standalone: nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true,
      built: WebUpdate.entryScript(document.documentElement.innerHTML) !== null,
      permission: 'Notification' in window ? Notification.permission : 'default',
    });
  }

  kinds(): PushKinds {
    return PushKindsRules.read(this.prefs.getJSON<unknown>(PrefKey.pushKinds, null));
  }

  /**
   * Whether this browser has a subscription the server can send to: one made with today's
   * key. One made with another (the keys were changed) is dropped here, so the sheet offers
   * to turn notifications on again.
   */
  async subscribed(): Promise<boolean> {
    if (this.availability() !== 'granted') return false;
    return (await this.subscription(false).catch(() => null)) !== null;
  }

  /**
   * Asks, from the tap itself: Safari only shows the question for a tap, and only if
   * nothing is awaited before it. Granted, everything is turned on and sent up. Also from
   * the tap when permission is already given but there's no subscription to send to.
   */
  async turnOn(): Promise<PushAvailability> {
    const before = this.availability();
    if (before !== 'ask' && before !== 'granted') return before;
    if (before === 'ask' && (await Notification.requestPermission()) !== 'granted') return this.availability();
    await this.subscription(true);
    // Sent whatever was sent before: this may be a new subscription for the same kinds.
    this.prefs.set(PrefKey.pushSent, null);
    this.prefs.setJSON(PrefKey.pushKinds, PushKindsRules.on);
    await this.sync();
    return this.availability();
  }

  /** The timetable's loaded weeks: sent up when they differ from what the server has. */
  setTargets(targets: PushTargets): void {
    this.targets = { ...targets, doneDeadlines: this.doneDeadlines() };
    void this.sync();
  }

  /** The deadlines ticked off on the Deadlines tab (`CompletedDeadlines`), newest kept under the cap. */
  private doneDeadlines(): string[] {
    const saved = this.prefs.getJSON<unknown>(PrefKey.completedDeadlines, []);
    const ids = Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : [];
    return [...new Set(ids)].slice(-PushTargetsRules.maxDone).sort();
  }

  /**
   * On sign-out. Unsubscribing kills the endpoint, so the server's row only ever gets a
   * "gone" back and is deleted on its next send; the session is already on its way out, so
   * there's no asking the server to delete it now.
   */
  forget(): void {
    this.prefs.set(PrefKey.pushKinds, null);
    this.prefs.set(PrefKey.pushSent, null);
    this.targets = null;
    if (this.availability() !== 'granted') return;
    this.queue = this.queue
      .then(() => this.subscription(false))
      .then((sub) => sub?.unsubscribe())
      .then(() => undefined)
      .catch(() => undefined);
  }

  /** One at a time, so two quick changes can't race each other to the server. */
  private sync(): Promise<void> {
    this.queue = this.queue.then(() => this.send()).catch(() => undefined);
    return this.queue;
  }

  private async send(): Promise<void> {
    if (!this.targets || this.availability() !== 'granted') return;
    const sub = await this.subscription(false);
    const json = sub?.toJSON();
    if (!sub || !json?.keys?.p256dh || !json.keys.auth) return;
    const kinds = this.kinds();
    const signature = PushTargetsRules.signature(sub.endpoint, kinds, this.targets);
    if (this.prefs.get(PrefKey.pushSent) === signature) return;
    await this.store.save({ endpoint: sub.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth, kinds, targets: this.targets });
    this.prefs.set(PrefKey.pushSent, signature);
  }

  /**
   * This browser's subscription, made when `create` and there isn't one. Registers the
   * service worker now if the offline copy hasn't yet (it waits for the page to go quiet).
   * One made with another key is unsubscribed: the push service refuses every send to it
   * (Apple's VapidPkHashMismatch), and it can't be moved onto the new key, only replaced.
   * The server's copy goes first: unsubscribing doesn't tell the server, and Apple answers
   * a stale key with a 400, not the "gone" that would have the sender delete it.
   */
  private async subscription(create: boolean): Promise<PushSubscription | null> {
    const root = webAppRoot();
    const registration = (await navigator.serviceWorker.getRegistration(root))
      ?? (create ? await navigator.serviceWorker.register(`${root}sw.js`, { scope: root }) : null);
    if (!registration || !this.vapidKey) return null;
    const ready = await navigator.serviceWorker.ready;
    let existing = await ready.pushManager.getSubscription();
    if (existing && !sameVapidKey(existing.options.applicationServerKey, this.vapidKey)) {
      await this.store.delete(existing.endpoint).catch(() => undefined);
      await existing.unsubscribe().catch(() => undefined);
      this.prefs.set(PrefKey.pushSent, null);
      existing = null;
    }
    if (existing || !create) return existing;
    return ready.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes(this.vapidKey) });
  }
}
