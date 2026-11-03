import { CancellationRules } from '../src/core/cancellation';
import { PushEnvironment, pushAvailability, PushKindsRules, PushTargetsRules, vapidKeyBytes } from '../src/core/webPush';
import { at, event } from './helpers';

const desktop: PushEnvironment = {
  serviceWorker: true, pushManager: true, notification: true, iOS: false, standalone: false, built: true, permission: 'default',
};

describe('Web push availability', () => {
  test('a browser with push asks first, then follows the answer', () => {
    expect(pushAvailability(desktop)).toBe('ask');
    expect(pushAvailability({ ...desktop, permission: 'granted' })).toBe('granted');
    expect(pushAvailability({ ...desktop, permission: 'denied' })).toBe('denied');
  });

  // iOS hides PushManager from a tab, so missing push there means "add it", not "can't".
  test('an iPhone in a tab is sent to the Home Screen, and asked once it is there', () => {
    const tab = { ...desktop, iOS: true, pushManager: false, notification: false };
    expect(pushAvailability(tab)).toBe('addToHomeScreen');
    expect(pushAvailability({ ...desktop, iOS: true, standalone: true })).toBe('ask');
  });

  test('no push, or a development build with no service worker to push to, is unsupported', () => {
    expect(pushAvailability({ ...desktop, pushManager: false })).toBe('unsupported');
    expect(pushAvailability({ ...desktop, built: false })).toBe('unsupported');
  });
});

describe('Web push kinds', () => {
  test('saved kinds read defensively, and anything unrecognised is off', () => {
    expect(PushKindsRules.read(null)).toEqual(PushKindsRules.off);
    expect(PushKindsRules.read({ classStatus: true, newDeadlines: 'yes' })).toEqual({ classStatus: true, newDeadlines: false, deadlineReminders: false });
    expect(PushKindsRules.read(PushKindsRules.on)).toEqual({ classStatus: true, newDeadlines: true, deadlineReminders: true });
  });
});

describe('Web push targets', () => {
  const now = at(2026, 11, 3, 12);
  const over = event('EEG1006[1]OC/L1/01', at(2026, 11, 3, 9), at(2026, 11, 3, 10), { moduleName: 'EEG1006[1] Materials Engineering' });
  const later = event('EEG1006[1]OC/P1/02', at(2026, 11, 4, 14), at(2026, 11, 4, 16), { moduleName: 'EEG1006[1] Materials Engineering' });
  const sooner = event('CA116[1]OC/L1/01', at(2026, 11, 3, 15), at(2026, 11, 3, 16), { moduleName: null });
  const names = new Map([['EEG1006', 'Materials Engineering']]);

  test('classes not yet over, soonest first; every module, named where the app has a name', () => {
    const targets = PushTargetsRules.from([later, over, sooner], names, now);
    expect(targets.eventKeys).toEqual([CancellationRules.eventKey(sooner), CancellationRules.eventKey(later)]);
    // A module's deadlines still matter after today's class of it is over.
    expect(targets.moduleKeys).toEqual(['CA116', 'EEG1006']);
    expect(targets.moduleNames).toEqual({ EEG1006: 'Materials Engineering' });
    // Filled in by WebPush from the Deadlines tab's ticks.
    expect(targets.doneDeadlines).toEqual([]);
  });

  test('the same weeks in another order are the same signature; a change is a new one', () => {
    const a = PushTargetsRules.from([later, sooner], names, now);
    const b = { ...a, eventKeys: [...a.eventKeys].reverse() };
    expect(PushTargetsRules.signature('https://push', PushKindsRules.on, a)).toBe(PushTargetsRules.signature('https://push', PushKindsRules.on, b));
    expect(PushTargetsRules.signature('https://push', PushKindsRules.off, a)).not.toBe(PushTargetsRules.signature('https://push', PushKindsRules.on, a));
    // Ticking a deadline off has to reach the server, or its reminders keep coming.
    expect(PushTargetsRules.signature('https://push', PushKindsRules.on, { ...a, doneDeadlines: ['d-1'] }))
      .not.toBe(PushTargetsRules.signature('https://push', PushKindsRules.on, a));
  });
});

test('a base64url VAPID key decodes to its bytes', () => {
  // "hello?" in base64 is aGVsbG8/ — base64url writes the / as _ and drops padding.
  expect([...vapidKeyBytes('aGVsbG8_')]).toEqual([...Buffer.from('hello?')]);
});
