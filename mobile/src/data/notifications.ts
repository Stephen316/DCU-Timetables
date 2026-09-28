import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { PlannedAlert } from '../core/classAlerts';
import { AlertPermission, AlertScheduler } from './alerts';

const CHANNEL = 'class-alerts';

/** Class alerts through `expo-notifications`: local notifications, no server involved. */
export class ExpoAlertScheduler implements AlertScheduler {
  /** One replacement at a time, so two quick re-plans can't interleave their cancels and adds. */
  private queue: Promise<void> = Promise.resolve();

  constructor() {
    // Shown while the app is open as well, as Calendar's are: the student may be on the
    // Deadlines tab when a class is about to start.
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
    });
    if (Platform.OS === 'android') {
      void Notifications.setNotificationChannelAsync(CHANNEL, {
        name: 'Class alerts',
        importance: Notifications.AndroidImportance.HIGH,
      }).catch(() => undefined);
    }
  }

  async permission(): Promise<AlertPermission> {
    return ExpoAlertScheduler.read(await Notifications.getPermissionsAsync());
  }

  async requestPermission(): Promise<AlertPermission> {
    return ExpoAlertScheduler.read(await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true, allowBadge: false },
    }));
  }

  replaceAll(alerts: PlannedAlert[]): Promise<void> {
    this.queue = this.queue.then(() => this.replace(alerts)).catch(() => undefined);
    return this.queue;
  }

  clear(): Promise<void> {
    this.queue = this.queue.then(() => Notifications.cancelAllScheduledNotificationsAsync()).catch(() => undefined);
    return this.queue;
  }

  private async replace(alerts: PlannedAlert[]): Promise<void> {
    let state = await this.permission();
    if (state === 'undetermined' && alerts.length > 0) state = await this.requestPermission();
    await Notifications.cancelAllScheduledNotificationsAsync();
    if (state !== 'granted') return;
    for (const alert of alerts) {
      await Notifications.scheduleNotificationAsync({
        identifier: alert.id,
        content: {
          title: alert.title,
          body: alert.body,
          sound: 'default',
          data: { eventID: alert.eventID },
          // Through Focus and the scheduled summary, as Calendar's alerts are.
          interruptionLevel: 'timeSensitive',
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: alert.fireAt, channelId: CHANNEL },
      });
    }
  }

  private static read(status: Notifications.NotificationPermissionsStatus): AlertPermission {
    if (status.granted) return 'granted';
    const ios = status.ios?.status;
    if (ios === Notifications.IosAuthorizationStatus.PROVISIONAL || ios === Notifications.IosAuthorizationStatus.EPHEMERAL) return 'granted';
    return status.canAskAgain && status.status === 'undetermined' ? 'undetermined' : 'denied';
  }
}

/**
 * Opens the class a tapped alert is for — the tap that launched the app as well as one made
 * while it's running.
 */
export function listenForAlertTaps(open: (eventID: string) => void): () => void {
  if (Platform.OS === 'web') return () => undefined;
  const handle = (response: Notifications.NotificationResponse) => {
    if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const id = response.notification.request.content.data?.eventID;
    if (typeof id === 'string') open(id);
    void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
  };
  const last = Notifications.getLastNotificationResponse();
  if (last) handle(last);
  const subscription = Notifications.addNotificationResponseReceivedListener(handle);
  return () => subscription.remove();
}
