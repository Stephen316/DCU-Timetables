import { CancellationRules, CancellationStatus } from '../../core/cancellation';
import { ClassHighlight, Deadline, DeadlineRules } from '../../core/deadline';
import { PagerBounds, PagerIndex } from '../../core/misc';
import { TimetableAudience, TimetableChange, TimetableChanges } from '../../core/profile';
import { campusName, parsedLocations } from '../../core/roomLocation';
import { ClashDetector, DefaultDay } from '../../core/schedule';
import { addDays, startOfDay } from '../../core/time';
import { groupKeyOf as groupKey, TeachingWeek, TimetableCategory, TimetableEvent } from '../../core/timetableEvent';
import { errorMessage } from '../../data/rest';
import { Services } from '../../data/services';
import { TimetableSource } from '../../data/dcuApi';
import { WidgetSnapshotPublisher } from '../../data/widgets';
import { Observable } from '../../state/hooks';

export interface DayEvents {
  day: Date;
  events: TimetableEvent[];
}

/**
 * The signed-in timetable: the weeks loaded so far, filtered to the student's groups, with
 * the crowd's reports, the verdicts and the deadlines laid over them.
 *
 * Shared by the timetable and deadlines tabs — the deadlines tab takes its module list from
 * the weeks already loaded, so it costs no extra request and can't disagree with the grid.
 */
export class WeekModel extends Observable {
  /** The academic year has a first and a last week; the pager stops at both. */
  static readonly weekBounds: PagerBounds = 'clamped';
  /** A week and a day, so the next class day is in the widget even across a long weekend. */
  private static readonly widgetDays = 8;

  /** Current week, filtered to groups. */
  events: TimetableEvent[] = [];
  clashingIDs = new Set<string>();
  isLoading = false;
  errorText: string | null = null;
  weekLabel = '';
  /** Monday of the week being shown, so the day view can lay out Mon–Fri. */
  weekStart: Date | null = null;
  /** Position in `weeks`. */
  weekIndex = 0;
  /** Mon–Fri index for the day view (0 = Monday). */
  dayIndex = 0;
  weeks: TeachingWeek[] = [];
  /** Filtered events keyed by week number, for the weeks the pager can reach. */
  eventsByWeekNumber = new Map<number, TimetableEvent[]>();
  /** Crowd-sourced tallies and verdicts for the visible week, keyed by event key. */
  cancellations = new Map<string, CancellationStatus>();
  /** Deadlines for every module seen, so a class can be outlined on the day one falls. */
  deadlines: Deadline[] = [];
  /** `moduleKeys` as of the last load, for the deadlines tab. */
  loadedModuleKeys: string[] = [];

  /**
   * Every status fetched this session, whichever week it was for. The widget shows the
   * coming days whatever week is on screen, so it can't rely on `cancellations` alone.
   */
  private knownStatuses = new Map<string, CancellationStatus>();
  private rawByWeekNumber = new Map<number, TimetableEvent[]>();
  private changes: TimetableChange[];
  private started = false;

  constructor(
    readonly services: Services,
    readonly programme: TimetableCategory,
    private readonly source: TimetableSource,
    /** Whose changes apply. Null for a programme the console has no course for. */
    private readonly audience: TimetableAudience | null,
    private hiddenGroups: Set<string>,
  ) {
    super();
    this.changes = audience ? services.changeCache.changes(audience.courseKey) : [];
  }

  // MARK: - Reports and deadlines

  status(event: TimetableEvent): CancellationStatus {
    return this.cancellations.get(CancellationRules.eventKey(event)) ?? CancellationStatus.none;
  }

  /** What (if anything) to outline a class with. */
  highlight(event: TimetableEvent): ClassHighlight | null {
    return DeadlineRules.highlight(event, this.deadlines, this.status(event));
  }

  /** Non-fatal: a reporting outage must never stop the timetable itself showing. */
  async refreshCancellations(): Promise<void> {
    const keys = this.events.map((e) => CancellationRules.eventKey(e));
    if (keys.length === 0) {
      this.cancellations = new Map();
      this.changed();
      return;
    }
    // Together, so one pass builds the statuses. A failed report fetch degrades to
    // verdicts-only rather than leaving the week blank of both.
    const [tallies, verdicts] = await Promise.all([
      this.services.cancellations.tallies(keys).catch(() => null),
      this.services.verdicts.verdicts(keys).catch(() => null),
    ]);
    if (tallies === null && verdicts === null) return;
    this.cancellations = CancellationRules.statusesFromTallies(tallies ?? [], verdicts ?? []);
    // Keys with no reports are absent from the result, so clear this week's first or a
    // withdrawn report would stay flagged on the widget.
    for (const key of keys) this.knownStatuses.delete(key);
    for (const [key, status] of this.cancellations) this.knownStatuses.set(key, status);
    this.changed();
  }

  /**
   * Non-fatal: no deadlines just means no coloured borders. Asks for every module seen in
   * any loaded week, so the deadlines widget doesn't lose a module that doesn't meet this week.
   */
  async refreshDeadlines(): Promise<void> {
    const modules = new Set([...this.moduleKeys(), ...this.events.map(DeadlineRules.moduleKey)]);
    if (modules.size === 0) {
      this.deadlines = [];
      this.changed();
      return;
    }
    try {
      this.deadlines = await this.services.deadlines.deadlinesForModules([...modules]);
      this.changed();
    } catch {
      // Keep what was there.
    }
  }

  /**
   * Every module seen in any week loaded so far — from the raw events, before group
   * filtering: hiding a lab group doesn't stop you taking the module.
   */
  moduleKeys(): string[] {
    const keys = new Set<string>();
    for (const list of this.rawByWeekNumber.values()) for (const e of list) keys.add(DeadlineRules.moduleKey(e));
    return [...keys].sort();
  }

  // MARK: - The week on screen

  private get currentWeek(): TeachingWeek | null {
    return this.weeks[this.weekIndex] ?? null;
  }

  /** The campus shared by every located class this week — null if they span campuses. */
  get campusName(): string | null {
    const campuses = new Set(this.events.flatMap((e) => parsedLocations(e).flatMap((l) => (l.campus ? [l.campus] : []))));
    return campuses.size === 1 ? campusName([...campuses][0]) : null;
  }

  /** Current week's events grouped by calendar day. */
  get eventsByDay(): DayEvents[] {
    const week = this.currentWeek;
    return grouped(week ? this.eventsByWeekNumber.get(week.number) ?? [] : []);
  }

  /** Any week's events grouped by day — the calendar pager asks for its neighbours. */
  eventsByDayForWeekIndex(index: number): DayEvents[] {
    const resolved = PagerIndex.resolve(index, this.weeks.length, WeekModel.weekBounds);
    if (resolved === null) return [];
    return grouped(this.eventsByWeekNumber.get(this.weeks[resolved].number) ?? []);
  }

  /** Every event loaded this session, for opening a class's page by id. */
  eventWithID(id: string): TimetableEvent | null {
    for (const list of this.eventsByWeekNumber.values()) {
      const found = list.find((e) => e.id === id);
      if (found) return found;
    }
    return null;
  }

  async start(): Promise<void> {
    if (this.weeks.length === 0) {
      try {
        const calendar = await this.source.weekCalendar();
        this.weeks = calendar.weeks;
        const current = calendar.current();
        const index = current ? calendar.weeks.findIndex((w) => w.number === current.number) : -1;
        if (index >= 0) this.weekIndex = index;
        this.errorText = null;
      } catch (error) {
        this.errorText = errorMessage(error, "Couldn't load the calendar.");
        this.changed();
      }
    }
    this.started = true;
    await this.loadCurrentWeek();
  }

  /** Moves the pager and loads the week there. */
  stepIndex(delta: number): void {
    if (this.weeks.length === 0) return;
    this.setWeekIndex(PagerIndex.step(this.weekIndex, delta, this.weeks.length, WeekModel.weekBounds));
  }

  setWeekIndex(index: number): void {
    if (index === this.weekIndex) return;
    this.weekIndex = index;
    this.changed();
    void this.loadCurrentWeek();
  }

  /** Whether the chevron in that direction has anywhere to go. */
  canStep(delta: number): boolean {
    return PagerIndex.canStep(this.weekIndex, delta, this.weeks.length, WeekModel.weekBounds);
  }

  setDayIndex(index: number): void {
    if (index === this.dayIndex) return;
    this.dayIndex = index;
    this.changed();
  }

  /**
   * Opens the day view on today — or tomorrow from 6pm, or Monday at the weekend. Friday
   * evening and the weekend want Monday of the *next* week, so this can move the week as
   * well as the day. Stepping changes `weekStart`, which calls this again; the second pass
   * finds the day inside the new week and stops.
   */
  resetToDefaultDay(now: Date = new Date()): void {
    if (!this.weekStart) return;
    const target = DefaultDay.target(this.weekStart, now);
    this.dayIndex = target.dayIndex;
    this.changed();
    if (target.weekStep !== 0) this.stepIndex(target.weekStep);
  }

  /** Re-apply group filtering when the student changes their selection. */
  updateHiddenGroups(hidden: Set<string>): void {
    this.hiddenGroups = hidden;
    this.applyFilter();
    // A group just hidden is a class the widget must stop pointing at.
    this.publishWidgetSnapshot();
  }

  /** Re-read the saved changes after a refresh downloaded new ones. */
  reloadChanges(): void {
    if (!this.audience) return;
    this.changes = this.services.changeCache.changes(this.audience.courseKey);
    this.applyFilter();
    this.publishWidgetSnapshot();
  }

  /** Fetch every loaded week again — the rotation behind them changed. */
  async reloadAll(): Promise<void> {
    this.rawByWeekNumber = new Map();
    await this.loadCurrentWeek();
  }

  /**
   * Idempotent: already-loaded weeks only refresh their labels. Neighbours are fetched so a
   * drag has real content to show.
   */
  async loadCurrentWeek(): Promise<void> {
    if (!this.started) return;
    const week = this.currentWeek;
    if (!week) return;
    this.weekLabel = `Week ${week.label}`;
    const moved = this.weekStart?.getTime() !== week.firstDay.getTime();
    this.weekStart = week.firstDay;
    this.errorText = null;
    this.applyFilter();
    if (moved) this.resetToDefaultDay();

    if (!this.rawByWeekNumber.has(week.number)) {
      this.isLoading = true;
      this.changed();
      await this.load(week, true);
      this.isLoading = false;
      this.changed();
    }
    await this.refreshCancellations();
    await this.refreshDeadlines();
    this.publishWidgetSnapshot();

    let loadedNeighbour = false;
    for (const neighbour of this.neighbours(this.weekIndex)) {
      if (this.rawByWeekNumber.has(neighbour.number)) continue;
      await this.load(neighbour, false);
      loadedNeighbour = true;
    }
    // Next week's Monday is what a Friday-evening widget shows, and it arrives here.
    if (loadedNeighbour) this.publishWidgetSnapshot();
  }

  /**
   * Hands the home-screen widgets what is on screen: the next week of classes from every
   * loaded week, so browsing ahead in the app never leaves the widget with nothing for today.
   * This model is the only writer — it alone has the week, the tallies and the deadlines.
   */
  private publishWidgetSnapshot(): void {
    const today = startOfDay(new Date());
    const horizon = addDays(today, WeekModel.widgetDays);
    const upcoming: TimetableEvent[] = [];
    for (const list of this.eventsByWeekNumber.values()) {
      for (const e of list) if (e.start >= today && e.start < horizon) upcoming.push(e);
    }
    const statuses = this.knownStatuses;
    WidgetSnapshotPublisher.publish(
      WidgetSnapshotPublisher.snapshot(upcoming, this.deadlines, (e) => statuses.get(CancellationRules.eventKey(e)) ?? CancellationStatus.none),
    );
  }

  private neighbours(index: number): TeachingWeek[] {
    return [-1, 1].flatMap((delta) => {
      const resolved = PagerIndex.resolve(index + delta, this.weeks.length, WeekModel.weekBounds);
      return resolved === null ? [] : [this.weeks[resolved]];
    });
  }

  private async load(week: TeachingWeek, isCurrent: boolean): Promise<void> {
    const cached = await this.services.timetableCache.snapshot(this.programme.identity, week.number);
    if (cached) {
      this.rawByWeekNumber.set(week.number, cached.events);
      this.applyFilter();
    }
    try {
      const fetched = await this.source.events(this.programme, [week]);
      this.rawByWeekNumber.set(week.number, fetched);
      this.applyFilter();
      await this.services.timetableCache.store({ categoryID: this.programme.identity, weekNumber: week.number, events: fetched, fetchedAt: new Date() });
    } catch (error) {
      if (isCurrent && (this.rawByWeekNumber.get(week.number) ?? []).length === 0) {
        this.errorText = errorMessage(error, "Couldn't load this week.");
        this.changed();
      }
    }
  }

  private applyFilter(): void {
    // Changes first, then the student's own group filter — so an added class for their
    // group can still be hidden by them like any other.
    const filtered = new Map<number, TimetableEvent[]>();
    for (const [number, events] of this.rawByWeekNumber) {
      const weekStart = this.weeks.find((w) => w.number === number)?.firstDay ?? null;
      const changed = TimetableChanges.apply(events, this.changes, this.audience, weekStart);
      filtered.set(number, this.hiddenGroups.size === 0 ? changed : changed.filter((e) => !this.hiddenGroups.has(groupKey(e))));
    }
    this.eventsByWeekNumber = filtered;
    this.loadedModuleKeys = sameList(this.loadedModuleKeys, this.moduleKeys());
    const week = this.currentWeek;
    const current = week ? filtered.get(week.number) ?? [] : [];
    this.events = current;
    this.clashingIDs = ClashDetector.clashingEventIDs(current);
    this.changed();
  }
}

function grouped(list: TimetableEvent[]): DayEvents[] {
  const byDay = new Map<number, TimetableEvent[]>();
  for (const e of list) {
    const day = startOfDay(e.start).getTime();
    byDay.set(day, [...(byDay.get(day) ?? []), e]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a - b)
    .map(([day, events]) => ({ day: new Date(day), events: events.sort((a, b) => a.start.getTime() - b.start.getTime()) }));
}

/** Keeps the old array when nothing changed, so a list keyed on it doesn't reload. */
function sameList(old: string[], next: string[]): string[] {
  return old.length === next.length && old.every((v, i) => v === next[i]) ? old : next;
}
