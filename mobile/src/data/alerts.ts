import { PlannedAlert } from '../core/classAlerts';

export type AlertPermission = 'granted' | 'denied' | 'undetermined';

/**
 * Hands class alerts to the phone to fire. The Expo version is built in `platform.ts` only,
 * so nothing that tests or the web build import pulls in the native module.
 */
export interface AlertScheduler {
  permission(): Promise<AlertPermission>;
  /** Asks once; the system won't ask again after a refusal, so the answer is final. */
  requestPermission(): Promise<AlertPermission>;
  /** Replaces every pending alert with these. Asks for permission first if it never has. */
  replaceAll(alerts: PlannedAlert[]): Promise<void>;
  clear(): Promise<void>;
}

/** For tests, the web build and the preview: remembers the last plan and fires nothing. */
export class MemoryAlertScheduler implements AlertScheduler {
  scheduled: PlannedAlert[] = [];
  replaceCount = 0;
  constructor(private state: AlertPermission = 'granted') {}
  async permission() { return this.state; }
  async requestPermission() { return this.state; }
  async replaceAll(alerts: PlannedAlert[]) {
    this.replaceCount += 1;
    this.scheduled = this.state === 'granted' ? alerts : [];
  }
  async clear() { this.scheduled = []; }
}
