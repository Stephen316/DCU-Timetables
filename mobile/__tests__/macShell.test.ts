import { Platform } from 'react-native';
import { listenForMacAlertTaps, MacShell } from '../src/data/macShell';
import { at } from './helpers';

/** Stands in for `AlertBridge.swift`: answers as the Mac app would and records what it was sent. */
class FakeMac {
  sent: { kind: string; [key: string]: unknown }[] = [];
  permission = 'undetermined';
  tap: string | null = null;
  async postMessage(message: { kind: string; [key: string]: unknown }) {
    this.sent.push(message);
    switch (message.kind) {
      case 'alerts.request':
        this.permission = 'granted';
        return this.permission;
      case 'alerts.permission':
        return this.permission;
      case 'alerts.takeTap': {
        const tap = this.tap;
        this.tap = null;
        return tap;
      }
      default:
        return null;
    }
  }
}

function installMac(): FakeMac {
  const mac = new FakeMac();
  jest.replaceProperty(Platform, 'OS', 'web');
  (globalThis as { webkit?: unknown }).webkit = { messageHandlers: { dcuMac: mac } };
  return mac;
}

afterEach(() => {
  delete (globalThis as { webkit?: unknown }).webkit;
  jest.restoreAllMocks();
});

describe('Mac app bridge', () => {
  test('is absent in a browser, which has no webkit handler', () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    expect(MacShell.isPresent()).toBe(false);
    expect(MacShell.alerts()).toBeNull();
  });

  test('asks once before the first alerts, then hands them over with the time in milliseconds', async () => {
    const mac = installMac();
    const alerts = MacShell.alerts()!;
    const fireAt = at(2026, 9, 28, 9, 45);
    await alerts.replaceAll([{ id: 'a1', eventID: 'lec', fireAt, title: 'Materials Engineering', body: '10:00 · GLA.HG20' }]);
    expect(mac.sent.map((m) => m.kind)).toEqual(['alerts.permission', 'alerts.request', 'alerts.replace']);
    expect(mac.sent[2].alerts).toEqual([
      { id: 'a1', eventID: 'lec', fireAt: fireAt.getTime(), title: 'Materials Engineering', body: '10:00 · GLA.HG20' },
    ]);

    mac.sent = [];
    await alerts.replaceAll([]);
    expect(mac.sent.map((m) => m.kind)).toEqual(['alerts.replace']);
    expect(await alerts.permission()).toBe('granted');
  });

  test('a clicked alert opens its class, whether it launched the app or came while it was open', async () => {
    const mac = installMac();
    // The test runs without a DOM; the page's window is an event target.
    const events = new EventTarget();
    const page = window as unknown as Record<string, unknown>;
    page.addEventListener = events.addEventListener.bind(events);
    page.removeEventListener = events.removeEventListener.bind(events);
    mac.tap = 'lec';
    const opened: string[] = [];
    const stop = listenForMacAlertTaps((id) => opened.push(id));
    await new Promise((r) => setTimeout(r, 0));
    expect(opened).toEqual(['lec']);

    mac.tap = 'lab';
    events.dispatchEvent(new Event('dcumac:alerttap'));
    await new Promise((r) => setTimeout(r, 0));
    expect(opened).toEqual(['lec', 'lab']);
    stop();
    delete page.addEventListener;
    delete page.removeEventListener;
  });
});
