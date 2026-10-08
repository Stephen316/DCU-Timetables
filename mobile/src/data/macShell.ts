import { Platform } from 'react-native';
import { PlannedAlert } from '../core/classAlerts';
import { AlertPermission, AlertScheduler } from './alerts';

/**
 * The Mac app (`mac/` in the repo): this web build in a native window. It answers messages
 * posted to `dcuMac` — see `AlertBridge.swift` — which is how the web build gets class
 * alerts there, as a Mac notification that fires with the window closed.
 */
interface Bridge {
  postMessage(message: { kind: string; [key: string]: unknown }): Promise<unknown>;
}

function bridge(): Bridge | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const webkit = (window as { webkit?: { messageHandlers?: { dcuMac?: Bridge } } }).webkit;
  return webkit?.messageHandlers?.dcuMac ?? null;
}

export const MacShell = {
  /** True inside the Mac app, which shows the week calendar and never the day list. */
  isPresent(): boolean {
    return bridge() !== null;
  },

  /** The alerts for the Mac app; null anywhere else. */
  alerts(): AlertScheduler | null {
    const b = bridge();
    return b ? new MacAlertScheduler(b) : null;
  },

  /** Notifications in System Settings, where a refusal is undone. */
  openNotificationSettings(): void {
    void bridge()?.postMessage({ kind: 'alerts.openSettings' }).catch(() => undefined);
  },
};

class MacAlertScheduler implements AlertScheduler {
  /** One replacement at a time, as on the phone. */
  private queue: Promise<void> = Promise.resolve();

  constructor(private bridge: Bridge) {}

  async permission(): Promise<AlertPermission> {
    return MacAlertScheduler.read(await this.bridge.postMessage({ kind: 'alerts.permission' }));
  }

  async requestPermission(): Promise<AlertPermission> {
    return MacAlertScheduler.read(await this.bridge.postMessage({ kind: 'alerts.request' }));
  }

  replaceAll(alerts: PlannedAlert[]): Promise<void> {
    this.queue = this.queue.then(() => this.replace(alerts)).catch(() => undefined);
    return this.queue;
  }

  clear(): Promise<void> {
    this.queue = this.queue.then(() => this.bridge.postMessage({ kind: 'alerts.clear' })).then(() => undefined).catch(() => undefined);
    return this.queue;
  }

  private async replace(alerts: PlannedAlert[]): Promise<void> {
    if (alerts.length > 0 && (await this.permission()) === 'undetermined') await this.requestPermission();
    await this.bridge.postMessage({
      kind: 'alerts.replace',
      alerts: alerts.map((a) => ({ id: a.id, eventID: a.eventID, fireAt: a.fireAt.getTime(), title: a.title, body: a.body })),
    });
  }

  private static read(answer: unknown): AlertPermission {
    return answer === 'granted' || answer === 'denied' ? answer : 'undetermined';
  }
}

/**
 * Opens the class a clicked alert is for. The Mac app holds the click until asked, so a
 * click that launched it is collected here once the page is up; a later one arrives as an
 * event telling the page to ask again.
 */
export function listenForMacAlertTaps(open: (eventID: string) => void): () => void {
  const b = bridge();
  if (!b) return () => undefined;
  const take = () => {
    void b.postMessage({ kind: 'alerts.takeTap' })
      .then((id) => {
        if (typeof id === 'string') open(id);
      })
      .catch(() => undefined);
  };
  take();
  window.addEventListener('dcumac:alerttap', take);
  return () => window.removeEventListener('dcumac:alerttap', take);
}
