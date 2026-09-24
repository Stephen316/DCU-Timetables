import { CancellationRules, CancellationTally } from '../core/cancellation';
import { Deadline, DeadlineStanding, makeDeadline } from '../core/deadline';
import { parseActivityCode } from '../core/activityCode';
import { addDays, daysBetween, HOUR, startOfDay, startOfWeek } from '../core/time';
import { EventType, TimetableCategory, TimetableEvent, WeekCalendar } from '../core/timetableEvent';
import { TimetableSource } from './dcuApi';
import { createServices, Services } from './services';
import { SecretStore } from './session';
import { AsyncKV, MemoryKV, PrefKey } from './storage';
import { CancellationStore, DeadlineStore } from './stores';

/**
 * Fixture data for looking at screens without a network or an account: a plausible
 * first-year week, dated around today so "next class" and "today" have something to point
 * at whenever the preview is opened. Nothing here touches the real device storage.
 */
export const PreviewData = {
  get monday(): Date {
    return startOfWeek(new Date());
  },

  /** Today as a Mon–Fri offset, clamped so a weekend preview still shows a full day. */
  get todayOffset(): number {
    return Math.min(Math.max(daysBetween(PreviewData.monday, new Date()), 0), 4);
  },

  at(day: number, hour: number): Date {
    const d = addDays(PreviewData.monday, day);
    d.setHours(hour, 0, 0, 0);
    return d;
  },

  event(id: string, title: string, activity: string, start: Date, hours: number, room: string, staff: string[] = [], type: EventType = 'onCampus'): TimetableEvent {
    return {
      id, start, end: new Date(start.getTime() + hours * HOUR), type, locations: room ? [room] : [], moduleName: title,
      staff, activity: parseActivityCode(activity), weekLabels: ['1-12'],
    };
  },

  /**
   * Today's shape is set relative to the clock: one class already over, the next starting
   * on the hour (so its highlight window is open), then one reported cancelled.
   */
  get today(): TimetableEvent[] {
    const next = new Date();
    next.setHours(next.getHours() + 1, 0, 0, 0);
    const e = PreviewData.event;
    return [
      e('t1', 'Computer Systems', 'CA106[1]OC/L1/01', new Date(next.getTime() - 3 * HOUR), 1, 'GLA.C114', ['Byrne, Ciara']),
      e('t2', 'Digital Innovation', 'CA107[1]OC/P1/02', next, 2, 'GLA.L125', ['Kelly, Owen', 'Nolan, Aoife']),
      e('t3', 'Networks', 'CA218[1]OC/L1/01', new Date(next.getTime() + 3 * HOUR), 1, 'GLA.XG14', ['Doyle, Martin']),
    ];
  },

  get week(): TimetableEvent[] {
    const e = PreviewData.event;
    const at = PreviewData.at;
    const events: TimetableEvent[] = [];
    for (let day = 0; day < 5; day++) {
      if (day === PreviewData.todayOffset) continue;
      events.push(
        e(`d${day}a`, 'Maths for Computing', 'MS121[1]OC/L1/01', at(day, 9), 1, 'GLA.QG15', ['Walsh, Emma']),
        e(`d${day}b`, 'Operating Systems', 'CA216[1]OC/L1/01', at(day, 11), 2, 'GLA.SA101', ['Fox, Liam']),
        e(`d${day}c`, 'Programming Lab', 'CA117[1]OC/P1/03', at(day, 14), 3, 'GLA.L101'),
      );
      if (day === 2) events.push(e(`d${day}d`, 'Ethics in Engineering', 'EE105[1]SY/T1/01', at(day, 12), 1, '', [], 'synchronous'));
    }
    const nextWeek = Array.from({ length: 5 }, (_, i) => i + 7).flatMap((day) => [
      e(`n${day}a`, 'Maths for Computing', 'MS121[1]OC/L1/01', at(day, 9), 1, 'GLA.QG15'),
      e(`n${day}b`, 'Operating Systems', 'CA216[1]OC/L1/01', at(day, 11), 2, 'GLA.SA101'),
    ]);
    return [...events, ...PreviewData.today, ...nextWeek];
  },

  deadlines(): Deadline[] {
    const now = new Date();
    return [
      makeDeadline({ id: 'dl-quiz', moduleKey: 'CA106', title: 'Quiz 2: memory hierarchy', due: addDays(now, 1), kind: 'quiz', submitterID: 'someone', isMine: false }),
      makeDeadline({ id: 'dl-sched', moduleKey: 'CA216', title: 'Scheduler assignment', due: addDays(now, 4), kind: 'assignment', submitterID: 'someone', isMine: false }),
      makeDeadline({ id: 'dl-sheet', moduleKey: 'MS121', title: 'Problem sheet 3', due: addDays(now, 9), kind: 'assignment', submitterID: 'preview-me', isMine: true }),
    ];
  },

  programme: { identity: 'preview', name: 'CASE1 (Computer Science-1)', categoryTypeIdentity: '' } as TimetableCategory,
  user: { id: 'preview-me', address: 'aoife.murphy5@mail.dcu.ie' },
};

class PreviewTimetableSource implements TimetableSource {
  async searchProgrammes(query: string): Promise<TimetableCategory[]> {
    return PreviewData.programme.name.toLowerCase().includes(query.toLowerCase()) ? [PreviewData.programme] : [];
  }

  async weekCalendar(): Promise<WeekCalendar> {
    const monday = PreviewData.monday;
    return new WeekCalendar(
      [{ number: 5, label: '5', firstDay: monday }, { number: 6, label: '6', firstDay: addDays(monday, 7) }],
      [],
    );
  }

  async events(_category: TimetableCategory, weeks: { firstDay: Date }[]): Promise<TimetableEvent[]> {
    const all = PreviewData.week;
    return weeks.flatMap((w) => {
      const start = startOfDay(w.firstDay).getTime();
      const end = addDays(w.firstDay, 7).getTime();
      return all.filter((e) => e.start.getTime() >= start && e.start.getTime() < end);
    });
  }
}

/** Four reports on today's Networks lecture — enough to flag it — and nothing else. */
class PreviewCancellationStore implements CancellationStore {
  async tallies(keys: string[]): Promise<CancellationTally[]> {
    const networks = PreviewData.today.find((e) => e.id === 't3')!;
    const key = CancellationRules.eventKey(networks);
    return keys.includes(key) ? [{ eventKey: key, reportCount: 4, onCount: 0, myStance: null }] : [];
  }
  async submit(): Promise<void> {}
  async withdraw(): Promise<void> {}
}

class PreviewDeadlineStore implements DeadlineStore {
  async deadlinesForModule(moduleKey: string) { return PreviewData.deadlines().filter((d) => d.moduleKey === moduleKey); }
  async deadlinesForModules() { return PreviewData.deadlines(); }
  async submit() {}
  async withdraw() {}
  async standings(ids: string[]) {
    return new Map(ids.length > 0 ? [[ids[0], new DeadlineStanding(4, true)]] : []);
  }
  async confirm() {}
  async unconfirm() {}
  async report() {}
  async hideAuthor() {}
  async hiddenAuthorCount() { return 0; }
  async unhideAllAuthors() {}
}

export async function createPreviewServices(_deviceKV: AsyncKV): Promise<Services> {
  const kv = new MemoryKV();
  await kv.setItem(`pref:${PrefKey.signedInUser}`, JSON.stringify(PreviewData.user));
  await kv.setItem(`pref:${PrefKey.studentID}`, 'A00000000');
  await kv.setItem(`pref:${PrefKey.selectedProgramme}`, JSON.stringify(PreviewData.programme));
  const secrets = new Map<string, string>();
  const secretStore: SecretStore = {
    get: async (k) => secrets.get(k) ?? null,
    set: async (k, v) => void secrets.set(k, v),
    remove: async (k) => void secrets.delete(k),
  };
  const services = await createServices({ kv, secrets: secretStore, env: {} });
  services.sourceOverride = new PreviewTimetableSource();
  services.cancellations = new PreviewCancellationStore();
  services.deadlines = new PreviewDeadlineStore();
  return services;
}
