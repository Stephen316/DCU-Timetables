import { Platform } from 'react-native';
import { CancellationStatus } from '../core/cancellation';
import { Deadline, DeadlineKind, DeadlineRules, isSatInClass } from '../core/deadline';
import { parsedLocations } from '../core/roomLocation';
import { isoSeconds } from '../core/time';
import { TimetableEvent, moduleCodeOf, titleOf } from '../core/timetableEvent';

/**
 * What the home-screen widgets draw, flattened — the app's half of the Swift widget
 * extension in `targets/widgets`.
 *
 * The widgets are still SwiftUI and run in their own process, so they can't call into
 * JavaScript. The app writes everything they need as one JSON string into the App Group's
 * shared UserDefaults, and they only read it (`WidgetSnapshotStore.swift`). The shape here
 * must stay in step with the `Codable` types in `WidgetSnapshot.swift`.
 */
export const WIDGET_APP_GROUP = 'group.com.stephenh.dcutimetable';
/** Must equal `WidgetSnapshotStore.snapshotKey`. */
export const WIDGET_SNAPSHOT_KEY = 'widgetSnapshot';
/** Must equal `WidgetSnapshotStore.Kind`. */
export const WidgetKind = { timetable: 'TimetableWidget', deadlines: 'DeadlinesWidget' } as const;

export interface WidgetClass {
  id: string;
  /** Module name where there is one, else the module code. */
  title: string;
  /** Module code, for the rows too narrow to carry the name. */
  code: string;
  /** Room text, already shortened. */
  room: string;
  start: string;
  end: string;
  state: 'scheduled' | 'cancelled' | 'moved';
}

export interface WidgetDeadline {
  id: string;
  title: string;
  code: string;
  due: string;
  /** SF Symbol for the kind, resolved here so the extension needs no `DeadlineKind`. */
  symbol: string;
  isSatInClass: boolean;
}

export interface WidgetSnapshot {
  classes: WidgetClass[];
  deadlines: WidgetDeadline[];
  updatedAt: string;
}

/** The SF Symbols the iOS app used for each kind, which the widget draws. */
export function deadlineSFSymbol(kind: DeadlineKind): string {
  switch (kind) {
    case 'assignment': return 'doc.text';
    case 'labReport': return 'flask';
    case 'quiz': return 'checklist';
    case 'exam': return 'graduationcap';
    case 'presentation': return 'person.wave.2';
    case 'other': return 'calendar';
  }
}

export const WidgetSnapshotPublisher = {
  /**
   * Rooms as bare codes ("FT301"), not "Polaris, Room 301": a widget row is one line of
   * small text, and a truncated building name is worse than no building name.
   */
  room(event: TimetableEvent): string {
    return parsedLocations(event).map((l) => l.code).filter((c) => c.length > 0).join(' · ');
  },

  widgetClass(event: TimetableEvent, status: CancellationStatus): WidgetClass {
    return {
      id: event.id,
      title: titleOf(event),
      code: moduleCodeOf(event) ?? event.activity.raw,
      room: WidgetSnapshotPublisher.room(event),
      // Whole seconds: Swift's `.iso8601` decoding refuses a fraction.
      start: isoSeconds(event.start),
      end: isoSeconds(event.end),
      state: status.isFlagged ? 'cancelled' : status.isMoved ? 'moved' : 'scheduled',
    };
  },

  widgetDeadline(deadline: Deadline): WidgetDeadline {
    return {
      id: deadline.id,
      title: deadline.title,
      code: deadline.moduleKey,
      due: isoSeconds(deadline.due),
      symbol: deadlineSFSymbol(deadline.kind),
      isSatInClass: isSatInClass(deadline.kind),
    };
  },

  snapshot(
    events: TimetableEvent[],
    deadlines: Deadline[],
    status: (event: TimetableEvent) => CancellationStatus,
    now: Date = new Date(),
  ): WidgetSnapshot {
    return {
      classes: [...events]
        .sort((a, b) => a.start.getTime() - b.start.getTime())
        .map((e) => WidgetSnapshotPublisher.widgetClass(e, status(e))),
      // The same horizon the deadlines tab uses, so the widget can't list something the app
      // has already dropped.
      deadlines: DeadlineRules.upcoming(deadlines, now).map(WidgetSnapshotPublisher.widgetDeadline),
      updatedAt: isoSeconds(now),
    };
  },

  /** Writes the snapshot and asks WidgetKit to redraw both widgets. iOS only. */
  publish(snapshot: WidgetSnapshot): void {
    if (Platform.OS !== 'ios') return;
    try {
      // Required lazily: the module reads the native `expo` global as it loads, which only an
      // iOS build has.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { ExtensionStorage } = require('@bacons/apple-targets') as typeof import('@bacons/apple-targets');
      new ExtensionStorage(WIDGET_APP_GROUP).set(WIDGET_SNAPSHOT_KEY, JSON.stringify(snapshot));
      ExtensionStorage.reloadWidget(WidgetKind.timetable);
      ExtensionStorage.reloadWidget(WidgetKind.deadlines);
    } catch {
      // No widget support in this build (Expo Go, say): nothing to update.
    }
  },
};
