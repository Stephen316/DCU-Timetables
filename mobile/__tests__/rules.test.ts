import {
  CancellationRules, CancellationStatus, EventVerdict, makeReport, CANCELLATION_THRESHOLD,
} from '../src/core/cancellation';
import {
  Deadline, deadlineBelongsTo, DeadlineRules, DeadlineSchedule, DeadlineStanding, makeDeadline, highlightReason,
} from '../src/core/deadline';
import { groupKeyOf } from '../src/core/timetableEvent';
import { at, event, utc } from './helpers';

const verdict = (state: EventVerdict['state'], fields: Partial<EventVerdict> = {}): EventVerdict => ({
  eventKey: 'K', state, ...fields,
});

describe('Cancellations', () => {
  test('event key is stable across devices but unique per occurrence', () => {
    const nine = event('EEG1006[1]OC/L1/01', utc(2026, 9, 16, 9));
    const sameAgain = event('EEG1006[1]OC/L1/01', utc(2026, 9, 16, 9));
    const later = event('EEG1006[1]OC/L1/01', utc(2026, 9, 16, 11));
    expect(CancellationRules.eventKey(nine)).toBe(CancellationRules.eventKey(sameAgain));
    expect(CancellationRules.eventKey(nine)).not.toBe(CancellationRules.eventKey(later));
    // The exact format the console and the database match on.
    expect(CancellationRules.eventKey(nine)).toBe('EEG1006[1]OC/L1/01|2026-09-16T09:00:00Z');
  });

  test('flags only at the threshold', () => {
    const reports = (ids: string[]) => ids.map((id) => makeReport('k', id));
    expect(CancellationRules.status('k', reports(['a', 'b']), 'z').isFlagged).toBe(false);
    expect(CancellationRules.status('k', reports(['a', 'b', 'c']), 'z').isFlagged).toBe(true);
  });

  test('one device cannot flag a class alone', () => {
    const spam = Array.from({ length: 5 }, () => makeReport('k', 'me'));
    const status = CancellationRules.status('k', spam, 'me');
    expect(status.reportCount).toBe(1);
    expect(status.isFlagged).toBe(false);
    expect(status.reportedByMe).toBe(true);
  });

  test('reports for other classes do not leak', () => {
    const all = CancellationRules.statusesFromReports(
      [makeReport('a', '1'), makeReport('a', '2'), makeReport('b', '3')], '1');
    expect(all.get('a')?.reportCount).toBe(2);
    expect(all.get('a')?.reportedByMe).toBe(true);
    expect(all.get('b')?.reportCount).toBe(1);
    expect(all.get('b')?.reportedByMe).toBe(false);
  });

  test('the summary never caps the count', () => {
    expect(new CancellationStatus(0).summary).toBe('Nobody has reported this class as cancelled');
    expect(new CancellationStatus(1, 0, 'cancelled').summary).toBe('1 person says this is cancelled');
    expect(new CancellationStatus(2).summary).toBe('2 people say this is cancelled');
    expect(new CancellationStatus(11).summary).toBe('11 people say this is cancelled');
  });

  test('flagging needs three reports and a net of two', () => {
    expect(new CancellationStatus(3).isFlagged).toBe(true);
    expect(new CancellationStatus(3, 1).isFlagged).toBe(true);
    expect(new CancellationStatus(3, 2).isFlagged).toBe(false);
    expect(new CancellationStatus(4, 2).isFlagged).toBe(true);
    expect(new CancellationStatus(5, 4).isFlagged).toBe(false);
  });

  test('two reports never flag however uncontradicted', () => {
    expect(new CancellationStatus(2).isFlagged).toBe(false);
    expect(new CancellationStatus(2, 0).netReports).toBe(2);
  });

  test('the net never goes below zero', () => expect(new CancellationStatus(1, 4).netReports).toBe(0));

  test('a verdict still outranks both sides', () => {
    expect(new CancellationStatus(0, 10, null, verdict('cancelled')).isFlagged).toBe(true);
    expect(new CancellationStatus(9, 0, null, verdict('running')).isFlagged).toBe(false);
  });

  test('reported-by-me means cancelled specifically', () => {
    expect(new CancellationStatus(1, 0, 'cancelled').reportedByMe).toBe(true);
    expect(new CancellationStatus(1, 1, 'on').reportedByMe).toBe(false);
    expect(new CancellationStatus(1).reportedByMe).toBe(false);
  });

  test('statuses split the two sides', () => {
    const status = CancellationRules.statusesFromReports(
      [makeReport('a', '1', 'cancelled'), makeReport('a', '2', 'cancelled'), makeReport('a', '3', 'on')], '3').get('a');
    expect(status?.reportCount).toBe(2);
    expect(status?.onCount).toBe(1);
    expect(status?.myStance).toBe('on');
  });

  test('one person counts once even holding both rows', () => {
    const earlier = new Date(100_000);
    const status = CancellationRules.statusesFromReports(
      [makeReport('a', 'me', 'on', new Date(earlier.getTime() + 60_000)), makeReport('a', 'me', 'cancelled', earlier)],
      'me',
    ).get('a');
    expect(status?.reportCount).toBe(0);
    expect(status?.onCount).toBe(1);
    expect(status?.myStance).toBe('on');
  });

  test('your own report is stated back', () => {
    expect(new CancellationStatus(1, 0, 'cancelled').myReportLine).toBe('You reported cancelled');
    expect(new CancellationStatus(1, 1, 'on').myReportLine).toBe('You reported this class went ahead');
    expect(new CancellationStatus(4).myReportLine).toBeNull();
  });

  test('others excludes you', () => {
    expect(new CancellationStatus(4, 0, 'cancelled').othersLine).toBe('3 others have reported cancelled');
    expect(new CancellationStatus(2, 0, 'cancelled').othersLine).toBe('1 other has reported cancelled');
    expect(new CancellationStatus(1, 0, 'cancelled').othersLine).toBeNull();
  });

  test('others counts everyone when you have not voted', () => {
    expect(new CancellationStatus(3).othersLine).toBe('3 people have reported cancelled');
    expect(new CancellationStatus(1).othersLine).toBe('1 person has reported cancelled');
    expect(new CancellationStatus(0).othersLine).toBeNull();
  });

  test('a dispute is only worth saying when there is one to dispute', () => {
    expect(new CancellationStatus(2, 1).disputedLine).toBe('1 person says it went ahead');
    expect(new CancellationStatus(2, 3).disputedLine).toBe('3 people say it went ahead');
    expect(new CancellationStatus(0, 2).disputedLine).toBeNull();
  });
});

describe('Verdicts', () => {
  const reports = (n: number) => Array.from({ length: n }, (_, i) => makeReport('K', `reporter-${i}`));

  test('with no verdict the crowd still decides at the threshold', () => {
    const status = CancellationRules.status('K', reports(CANCELLATION_THRESHOLD), 'me');
    expect(status.isFlagged).toBe(true);
    expect(status.isDecided).toBe(false);
  });

  test('a cancelled verdict flags a class nobody reported', () => {
    const status = CancellationRules.status('K', [], 'me', verdict('cancelled'));
    expect(status.isFlagged).toBe(true);
    expect(status.isDecided).toBe(true);
    expect(status.reportCount).toBe(0);
  });

  test('a running verdict beats any number of reports', () => {
    const status = CancellationRules.status('K', reports(CANCELLATION_THRESHOLD * 10), 'me', verdict('running'));
    expect(status.isFlagged).toBe(false);
    expect(status.isDecided).toBe(true);
  });

  test('moved is not cancelled', () => {
    const status = CancellationRules.status('K', [], 'me', verdict('moved', { roomOverride: 'Q119' }));
    expect(status.isFlagged).toBe(false);
    expect(status.isMoved).toBe(true);
  });

  test('the crowd count survives underneath a verdict', () => {
    const status = CancellationRules.status('K', reports(4), 'me', verdict('cancelled'));
    expect(status.reportCount).toBe(4);
    expect(status.crowdSummary).toBe('4 people had reported this as cancelled');
  });

  test('no crowd line when nobody reported', () => {
    expect(CancellationRules.status('K', [], 'me', verdict('cancelled')).crowdSummary).toBeNull();
  });

  test('a verdict appears even with no reports anywhere', () => {
    const statuses = CancellationRules.statusesFromReports([], 'me', [{ eventKey: 'QUIET', state: 'cancelled' }]);
    expect(statuses.get('QUIET')?.isFlagged).toBe(true);
  });

  test('verdicts and reports merge per class', () => {
    const statuses = CancellationRules.statusesFromReports(
      [makeReport('A', 'r1'), makeReport('A', 'r2'), makeReport('B', 'r1')], 'r1', [{ eventKey: 'A', state: 'running' }]);
    expect(statuses.get('A')?.reportCount).toBe(2);
    expect(statuses.get('A')?.isDecided).toBe(true);
    expect(statuses.get('A')?.isFlagged).toBe(false);
    expect(statuses.get('B')?.isDecided).toBe(false);
    expect(statuses.get('B')?.reportedByMe).toBe(true);
  });

  test("duplicate verdicts for one key don't crash", () => {
    const statuses = CancellationRules.statusesFromReports([], 'me', [
      { eventKey: 'A', state: 'cancelled' }, { eventKey: 'A', state: 'running' },
    ]);
    expect(statuses.get('A')).toBeDefined();
  });

  test('an unattributed verdict still reads as coming from a person', () => {
    expect(new CancellationStatus(0, 0, null, verdict('cancelled')).summary).toBe('Confirmed cancelled by an organiser');
    expect(new CancellationStatus(0, 0, null, verdict('cancelled', { decidedByLabel: '   ' })).summary)
      .toBe('Confirmed cancelled by an organiser');
    expect(new CancellationStatus(0, 0, null, verdict('cancelled', { decidedByLabel: 'the class rep' })).summary)
      .toBe('Confirmed cancelled by the class rep');
  });

  test('a verdict replaces the tally in the summary', () => {
    expect(new CancellationStatus(3).summary).toBe('3 people say this is cancelled');
    expect(new CancellationStatus(3, 0, null, verdict('cancelled')).summary).toBe('Confirmed cancelled by an organiser');
  });

  const lecture = event('EEG1006[1]SY/L1/01', utc(2026, 9, 21, 12));

  test('a verdict never renders as a crowd count', () => {
    const h = DeadlineRules.highlight(lecture, [], new CancellationStatus(0, 0, null, verdict('cancelled')));
    expect(h && highlightReason(h)).toBe('Cancelled · confirmed by an organiser');
  });

  test('without a verdict the crowd wording is kept', () => {
    const h = DeadlineRules.highlight(lecture, [], new CancellationStatus(3));
    expect(h && highlightReason(h)).toBe('Reported cancelled · 3 people');
  });

  test('a moved class is outlined in its own right', () => {
    const h = DeadlineRules.highlight(lecture, [], new CancellationStatus(0, 0, null, verdict('moved', { decidedByLabel: 'the class rep' })));
    expect(h && highlightReason(h)).toBe('Moved · the class rep');
  });

  test('a tally becomes a status without any reporter ids', () => {
    const s = CancellationRules.statusesFromTallies([{ eventKey: 'A', reportCount: 4, onCount: 0, myStance: 'cancelled' }]);
    expect(s.get('A')?.reportCount).toBe(4);
    expect(s.get('A')?.reportedByMe).toBe(true);
    expect(s.get('A')?.isFlagged).toBe(true);
  });

  test('a verdict with no tally row still shows', () => {
    expect(CancellationRules.statusesFromTallies([], [{ eventKey: 'QUIET', state: 'cancelled' }]).get('QUIET')?.isFlagged).toBe(true);
  });
});

describe('Class highlights', () => {
  const lectureMon = event('EEG1001[1]L1/01', at(2026, 9, 14, 9), at(2026, 9, 14, 11));
  const practicalThu = event('EEG1001[1]P2/03', at(2026, 9, 17, 9), at(2026, 9, 17, 11));
  const deadline = (title: string, kind: Deadline['kind'], day: number, pinned?: typeof practicalThu) =>
    makeDeadline({ moduleKey: 'EEG1001', atGroupKey: pinned ? groupKeyOf(pinned) : null, title, due: at(2026, 9, day, 17), kind, submitterID: 'someone' });
  const quiet = CancellationStatus.none;

  test('nothing due means no border', () => expect(DeadlineRules.highlight(lectureMon, [], quiet)).toBeNull());

  test('only the day it is due', () => {
    const list = [deadline('Assignment 2', 'assignment', 17)];
    expect(DeadlineRules.highlight(practicalThu, list, quiet)).toEqual({ kind: 'assignment', title: 'Assignment 2' });
    expect(DeadlineRules.highlight(lectureMon, list, quiet)).toBeNull();
  });

  test('a quiz outranks something due the same day', () => {
    const list = [deadline('Assignment 2', 'assignment', 17), deadline('Quiz 3', 'quiz', 17)];
    expect(DeadlineRules.highlight(practicalThu, list, quiet)).toEqual({ kind: 'test', title: 'Quiz 3' });
  });

  test('an exam counts as sat in class', () => {
    expect(DeadlineRules.highlight(practicalThu, [deadline('Lab exam', 'exam', 17)], quiet)).toEqual({ kind: 'test', title: 'Lab exam' });
  });

  test('a reported cancellation outranks both', () => {
    const list = [deadline('Quiz 3', 'quiz', 17)];
    expect(DeadlineRules.highlight(practicalThu, list, new CancellationStatus(4))).toEqual({ kind: 'cancelled', reportCount: 4, decidedBy: null });
    expect(DeadlineRules.highlight(practicalThu, list, new CancellationStatus(2))).toEqual({ kind: 'test', title: 'Quiz 3' });
  });

  test('a pinned deadline only colours its own class', () => {
    const sameDayLecture = event('EEG1001[1]L1/01', at(2026, 9, 17, 9));
    const pinned = [deadline('Lab report 2', 'labReport', 17, practicalThu)];
    expect(DeadlineRules.highlight(practicalThu, pinned, quiet)).toEqual({ kind: 'assignment', title: 'Lab report 2' });
    expect(DeadlineRules.highlight(sameDayLecture, pinned, quiet)).toBeNull();
  });

  test('an unpinned deadline colours any class that day', () => {
    const sameDayLecture = event('EEG1001[1]L1/01', at(2026, 9, 17, 9));
    expect(DeadlineRules.highlight(sameDayLecture, [deadline('Essay', 'assignment', 17)], quiet)).toEqual({ kind: 'assignment', title: 'Essay' });
  });

  test("another module's deadline is ignored", () => {
    const other = makeDeadline({ moduleKey: 'EEG1004', title: 'Assignment 1', due: at(2026, 9, 17, 17), submitterID: 'someone' });
    expect(DeadlineRules.highlight(practicalThu, [other], quiet)).toBeNull();
  });

  test('the banner lists only what is due at this class', () => {
    const list = [deadline('Lab report 2', 'labReport', 17, practicalThu), deadline('Essay', 'assignment', 20)];
    expect(DeadlineRules.dueAt(practicalThu, list).map((d) => d.title)).toEqual(['Lab report 2']);
  });
});

describe('Deadlines', () => {
  const inDays = (title: string, days: number) => {
    const due = new Date();
    due.setDate(due.getDate() + days);
    return makeDeadline({ moduleKey: 'EEG1001', title, due, submitterID: 'someone' });
  };

  test('upcoming is soonest first and drops the past', () => {
    const upcoming = DeadlineRules.upcoming([inDays('Lab 3', 9), inDays("Last term's essay", -2), inDays('Quiz', 1)]);
    expect(upcoming.map((d) => d.title)).toEqual(['Quiz', 'Lab 3']);
  });

  test("upcoming keeps today's deadlines for the whole day", () => {
    const list = [
      makeDeadline({ moduleKey: 'EEG1001', title: 'Handed in this morning', due: at(2026, 9, 17, 11), submitterID: 's' }),
      makeDeadline({ moduleKey: 'EEG1001', title: 'Yesterday', due: at(2026, 9, 16, 23), submitterID: 's' }),
    ];
    expect(DeadlineRules.upcoming(list, at(2026, 9, 17, 14)).map((d) => d.title)).toEqual(['Handed in this morning']);
  });

  test('rejects empty titles and past dates', () => {
    const future = new Date(Date.now() + 3600_000);
    expect(DeadlineRules.isValid('Assignment 1', future)).toBe(true);
    expect(DeadlineRules.isValid('   ', future)).toBe(false);
    expect(DeadlineRules.isValid('Assignment 1', new Date(Date.now() - 60_000))).toBe(false);
  });

  test('the countdown reads the way students think', () => {
    const now = at(2026, 9, 17, 10);
    expect(DeadlineRules.countdown(at(2026, 9, 17, 17), now)).toBe('today');
    expect(DeadlineRules.countdown(at(2026, 9, 18, 17), now)).toBe('tomorrow');
    expect(DeadlineRules.countdown(at(2026, 9, 24, 17), now)).toBe('in 7 days');
    expect(DeadlineRules.countdown(at(2026, 9, 17, 9), now)).toBe('today');
    expect(DeadlineRules.countdown(at(2026, 9, 16, 17), now)).toBe('overdue');
    // Across the October clock change a day is 25 hours, and still one day.
    expect(DeadlineRules.countdown(at(2026, 10, 26, 9), at(2026, 10, 24, 22))).toBe('in 2 days');
  });

  test('every class in a module shares one board', () => {
    const lecture = event('EEG1001[1]L1/01', new Date());
    const lab = event('EEG1001[1]P2/03', new Date());
    expect(DeadlineRules.moduleKey(lecture)).toBe(DeadlineRules.moduleKey(lab));
  });

  test('confirmed once enough people vouch', () => {
    const standings = DeadlineRules.standingsFromConfirmations(
      [['d1', 'a'], ['d1', 'b'], ['d1', 'c'], ['d2', 'a']].map(([deadlineID, confirmerID]) => ({ deadlineID, confirmerID })), 'a');
    expect(standings.get('d1')).toMatchObject({ confirmCount: 3, isConfirmed: true, confirmedByMe: true });
    expect(standings.get('d2')).toMatchObject({ confirmCount: 1, isConfirmed: false });
  });

  test('one student cannot confirm twice', () => {
    const list = Array.from({ length: 3 }, () => ({ deadlineID: 'd1', confirmerID: 'a' }));
    expect(DeadlineRules.standingsFromConfirmations(list, 'a').get('d1')?.confirmCount).toBe(1);
  });

  test('wording counts everyone and keeps going past the threshold', () => {
    const s = (n: number) => new DeadlineStanding(n, false);
    expect(s(0).summary).toBe('Nobody has confirmed this yet');
    expect(s(1).summary).toBe('1 person has confirmed');
    expect(s(2).summary).toBe('2 people have confirmed');
    expect(s(3).summary).toBe('3 people have confirmed');
    expect(s(11).summary).toBe('11 people have confirmed');
    expect(s(2).isConfirmed).toBe(false);
    expect(s(3).isConfirmed).toBe(true);
    expect(s(11).isConfirmed).toBe(true);
  });

  test('an unknown deadline has no standing', () => {
    expect(DeadlineRules.standingsFromConfirmations([], 'a').get('d1')).toBeUndefined();
  });

  test("your own vouch counts when the tally hasn't caught up", () => {
    expect(DeadlineRules.standingsFromCounts(new Map(), new Set(['d1'])).get('d1')).toMatchObject({ confirmCount: 1, confirmedByMe: true });
  });

  test('counts and own vouches merge', () => {
    const s = DeadlineRules.standingsFromCounts(new Map([['d1', 5], ['d2', 2]]), new Set(['d1']));
    expect(s.get('d1')).toMatchObject({ confirmCount: 5, confirmedByMe: true });
    expect(s.get('d2')?.confirmedByMe).toBe(false);
  });

  test('is_mine from the server decides', () => {
    const mine = makeDeadline({ moduleKey: 'M', title: 'T', due: new Date(), submitterID: '', isMine: true });
    const theirs = makeDeadline({ moduleKey: 'M', title: 'T', due: new Date(), submitterID: '', isMine: false });
    expect(deadlineBelongsTo(mine, 'anyone')).toBe(true);
    expect(deadlineBelongsTo(theirs, 'anyone')).toBe(false);
  });

  test("falls back to comparing ids when the server didn't say", () => {
    const local = makeDeadline({ moduleKey: 'M', title: 'T', due: new Date(), submitterID: 'me' });
    expect(local.isMine).toBeNull();
    expect(deadlineBelongsTo(local, 'me')).toBe(true);
    expect(deadlineBelongsTo(local, 'someone-else')).toBe(false);
  });
});

describe('Deadline schedule', () => {
  /** Wednesday 16 September 2026. That week runs Mon 14 – Sun 20. */
  const now = at(2026, 9, 16, 10);
  const section = (day: number, month = 9, hour = 12) => DeadlineSchedule.section(at(2026, month, day, hour), now);
  const d = (title: string, day: number, month = 9, kind: Deadline['kind'] = 'assignment') =>
    makeDeadline({ moduleKey: 'EEG1001', title, due: at(2026, month, day, 12), kind, submitterID: 'someone' });

  test('buckets by how soon it is', () => {
    expect(section(16)).toBe('today');
    expect(section(16, 9, 9)).toBe('today');
    expect(section(18)).toBe('thisWeek');
    expect(section(20)).toBe('thisWeek');
    expect(section(21)).toBe('nextWeek');
    expect(section(27)).toBe('nextWeek');
    expect(section(28)).toBe('later');
    expect(section(14, 12)).toBe('later');
  });

  test('groups in order and drops empty sections', () => {
    const grouped = DeadlineSchedule.grouped(
      [d('Exam', 14, 12, 'exam'), d('Quiz', 16, 9, 'quiz'), d('Lab report', 18, 9, 'labReport'), d("Last term's essay", 1)], now);
    expect(grouped.map((g) => g.section)).toEqual(['today', 'thisWeek', 'later']);
    expect(grouped.flatMap((g) => g.deadlines).map((x) => x.title)).toEqual(['Quiz', 'Lab report', 'Exam']);
  });

  test('separates what is sat in a room', () => {
    const list = [d('Quiz', 16, 9, 'quiz'), d('Exam', 17, 9, 'exam'), d('Assignment', 18), d('Lab report', 19, 9, 'labReport')];
    expect(DeadlineSchedule.sitInClass(list).map((x) => x.title)).toEqual(['Quiz', 'Exam']);
  });
});
