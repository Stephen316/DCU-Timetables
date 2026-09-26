import { Attendance, LecturerDirectory, lecturerDisplayName, lecturerInitials, makeLecturer, PagerDragState, PagerIndex, WeekdayIndex } from '../src/core/misc';
import { GroupCatalog } from '../src/core/groupCatalog';
import { groupKeyOf } from '../src/core/timetableEvent';
import { parseActivityCode } from '../src/core/activityCode';
import {
  AccountRules, makeAccountProfile, parseDCUEmail, parseRole, PasswordValidation, PublicIdentifier, StudentNumber,
} from '../src/core/identity';
import { locationDisplay, parseRoom, roomDisplayText } from '../src/core/roomLocation';
import { ClashDetector, DaySchedule, DaySlot, DefaultDay, NextClassWindow, WeekGrid, gapLabel } from '../src/core/schedule';
import { DublinTime, parseISO, isoSeconds } from '../src/core/time';
import { at, event, utc } from './helpers';

describe('Activity codes', () => {
  test('parses a full lecture code', () => {
    const a = parseActivityCode('BIO1000[1]OC/L1/01 Surname A - M');
    expect(a).toMatchObject({
      moduleCode: 'BIO1000', occurrence: '1', delivery: 'OC', kind: 'L', activityIndex: 1, group: '01',
      cohort: 'Surname A - M',
    });
  });

  test('parses a lab practical', () => {
    expect(parseActivityCode('CHM1008[1]OC/P1/01')).toMatchObject({ moduleCode: 'CHM1008', kind: 'P', group: '01', cohort: null });
  });

  test('parses asynchronous delivery', () => {
    expect(parseActivityCode('MTH1033[1]AY/L1/01')).toMatchObject({ moduleCode: 'MTH1033', delivery: 'AY', kind: 'L', group: '01' });
  });

  test('tolerates empty and garbage', () => {
    const empty = parseActivityCode('');
    expect(empty.kind).toBe('?');
    expect(empty.moduleCode).toBeNull();
    const odd = parseActivityCode('just some text');
    expect(odd.moduleCode).toBe('just');
    expect(odd.cohort).toBe('some text');
  });

  test('a cross-listed code parses cleanly', () => {
    const a = parseActivityCode('CHM1006[1]OC/L1/01, EEG1017[1]OC/L1/01');
    expect(a.moduleCode).toBe('CHM1006');
    expect(a.group).toBe('01'); // trailing comma stripped
    expect(a.cohort).toBeNull(); // second code is not a cohort
  });
});

describe('Account roles', () => {
  test('a plain student decides nothing', () => {
    const p = makeAccountProfile('u1', { role: 'student' });
    expect(AccountRules.canDecide(p)).toBe(false);
    expect(AccountRules.canAdminister(p)).toBe(false);
  });

  test('trusted decides but does not administer', () => {
    const p = makeAccountProfile('u1', { role: 'trusted' });
    expect(AccountRules.canDecide(p)).toBe(true);
    expect(AccountRules.canAdminister(p)).toBe(false);
  });

  test('admin does both', () => {
    const p = makeAccountProfile('u1', { role: 'admin' });
    expect(AccountRules.canDecide(p)).toBe(true);
    expect(AccountRules.canAdminister(p)).toBe(true);
  });

  test('a ban outranks the role while it lasts', () => {
    const now = new Date();
    const banned = makeAccountProfile('u1', { role: 'admin', bannedUntil: new Date(now.getTime() + 3600_000) });
    expect(AccountRules.isBanned(banned, now)).toBe(true);
    expect(AccountRules.canDecide(banned, now)).toBe(false);
    expect(AccountRules.canAdminister(banned, now)).toBe(false);
  });

  test('a ban that has run out is not a ban', () => {
    const now = new Date();
    const p = makeAccountProfile('u1', { role: 'trusted', bannedUntil: new Date(now.getTime() - 1000) });
    expect(AccountRules.isBanned(p, now)).toBe(false);
    expect(AccountRules.canDecide(p, now)).toBe(true);
  });

  test('an unknown role from the server is not a role', () => {
    expect(parseRole('superuser')).toBeNull();
  });
});

describe('Public identifier', () => {
  test('a well-formed id passes', () => expect(PublicIdentifier.isValid('K482913')).toBe(true));
  test.each(['I482913', 'O482913'])('%s: I and O are not in the alphabet', (c) => expect(PublicIdentifier.isValid(c)).toBe(false));
  test.each(['K48291', 'K4829134', '4482913', 'KK82913', '', 'K48291a'])('%s is the wrong shape', (c) =>
    expect(PublicIdentifier.isValid(c)).toBe(false));
  test('non-ASCII digits are not digits', () => expect(PublicIdentifier.isValid('K٤٨٢٩١٣')).toBe(false));
  test.each(['k482913', 'K-482913', 'k 482 913', ' K482913 '])('normalising accepts %p', (raw) =>
    expect(PublicIdentifier.normalised(raw)).toBe('K482913'));
  test('normalising still rejects a non-identifier', () => expect(PublicIdentifier.normalised('hello')).toBeNull());
});

describe('DCU email', () => {
  test('derives the name from the address', () => {
    const email = parseDCUEmail('stephen.harcourt2@mail.dcu.ie');
    expect(email?.displayName).toBe('Stephen Harcourt');
    expect(email?.givenName).toBe('Stephen');
    expect(email?.familyName).toBe('Harcourt');
    expect(email?.nameParts).toEqual(['stephen', 'harcourt']);
  });

  test('accepts both DCU domains and ignores case and spacing', () => {
    expect(parseDCUEmail('  Stephen.Harcourt@DCU.ie ')?.displayName).toBe('Stephen Harcourt');
    expect(parseDCUEmail('stephen.harcourt@mail.dcu.ie')?.displayName).toBe('Stephen Harcourt');
  });

  test('rejects non-DCU and lookalike domains', () => {
    for (const raw of [
      'stephen.harcourt@gmail.com', 'stephen.harcourt@dcu.ie.attacker.com', 'stephen.harcourt@notdcu.ie',
      'stephen.harcourt@student.dcu.ie', 'nodomain', '@dcu.ie',
    ]) {
      expect(parseDCUEmail(raw)).toBeNull();
    }
  });

  test('handles names without a dot or with extra parts', () => {
    expect(parseDCUEmail('harcourt3@dcu.ie')?.displayName).toBe('Harcourt');
    const long = parseDCUEmail('mary.anne.smith2@dcu.ie');
    expect(long?.displayName).toBe('Mary Anne Smith');
    expect(long?.givenName).toBe('Mary');
    expect(long?.familyName).toBe('Smith');
  });

  test('strips only trailing digits', () => {
    expect(parseDCUEmail('s3an.murphy12@dcu.ie')?.nameParts).toEqual(['s3an', 'murphy']);
  });
});

describe('Student number', () => {
  test('the barcode drops its leading 10 and trailing three digits and gains an A', () => {
    expect(StudentNumber.fromBarcode('1012345678001')).toBe('A12345678');
    expect(StudentNumber.fromBarcode(' 1000000042001\n')).toBe('A00000042');
  });

  test("a replacement card's suffix doesn't change the number", () => {
    expect(StudentNumber.fromBarcode('1012345678002')).toBe(StudentNumber.fromBarcode('1012345678001'));
  });

  test.each(['2012345678001', '101234567800', '10123456780012', '10123456780O1', 'A12345678', '', '*1012345678001*'])(
    'refuses %p as a card barcode',
    (code) => expect(StudentNumber.fromBarcode(code)).toBeNull(),
  );

  test('typing forgives case, spaces, hyphens and a missing A', () => {
    for (const typed of ['A12345678', 'a12345678', ' A1234 5678 ', 'A1234-5678', '12345678']) {
      expect(StudentNumber.fromTyped(typed)).toBe('A12345678');
    }
  });

  test('the number under the barcode can be typed instead', () => {
    expect(StudentNumber.fromTyped('1012345678001')).toBe('A12345678');
  });

  test('another leading letter is kept, not replaced', () => {
    expect(StudentNumber.fromTyped('b12345678')).toBe('B12345678');
  });

  test.each(['A1234567', 'A123456789', 'AB12345678', 'A1234567X', '1234567', '', 'Ａ12345678'])(
    'refuses the typo %p',
    (entry) => expect(StudentNumber.fromTyped(entry)).toBeNull(),
  );
});

describe('Password validation', () => {
  const problem = PasswordValidation.problem;
  test('says nothing until something is typed', () => expect(problem('', '')).toBeNull());
  test('mismatch is reported once the confirmation is started', () => {
    expect(problem('Correcthorse1', 'd')).toBe('mismatch');
    expect(problem('Correcthorse1', 'Different2')).toBe('mismatch');
    expect(problem('Correcthorse1', 'Correcthorse1')).toBeNull();
  });
  test('mismatch outranks the other rules', () => expect(problem('abc', 'abd')).toBe('mismatch'));
  test('too short while typing the first box', () => {
    expect(problem('Abc1', '')).toBe('tooShort');
    expect(problem('Longenough1', '')).toBeNull();
  });
  test('length is checked before composition', () => expect(problem('ab', '')).toBe('tooShort'));
  test('a capital is required', () => {
    expect(problem('lowercase1', '')).toBe('needsCapital');
    expect(problem('Lowercase1', '')).toBeNull();
  });
  test('a lower-case letter is required', () => {
    expect(problem('SHOUTING123', '')).toBe('needsLowercase');
    expect(problem('SHOUTINg123', '')).toBeNull();
  });
  test('a number is required', () => {
    expect(problem('Lettersonly', '')).toBe('needsNumber');
    expect(problem('Lettersonly1', '')).toBeNull();
  });
  test('a symbol is no longer a substitute for a number', () => {
    expect(problem('Lettersonly!', '')).toBe('needsNumber');
    expect(problem('Letters!only1', '')).toBeNull();
  });
  test('the character rules are reported in order', () => {
    expect(problem('aaaaaaaa', '')).toBe('needsCapital');
    expect(problem('AAAAAAAA', '')).toBe('needsLowercase');
    expect(problem('AaaaaaaA', '')).toBe('needsNumber');
  });
  test('account creation needs match, length and all three classes', () => {
    const can = PasswordValidation.canCreateAccount;
    expect(can('Correcthorse1', 'Correcthorse1')).toBe(true);
    expect(can('Short1a', 'Short1a')).toBe(false);
    expect(can('correcthorse1', 'correcthorse1')).toBe(false);
    expect(can('CORRECTHORSE1', 'CORRECTHORSE1')).toBe(false);
    expect(can('Correcthorse', 'Correcthorse')).toBe(false);
    expect(can('Correcthorse1', 'Different2')).toBe(false);
    expect(can('', '')).toBe(false);
  });
});

describe('Room locations', () => {
  test('decodes building, floor and room', () => {
    const loc = parseRoom('GLA.FT301');
    expect(loc.campus).toBe('glasnevin');
    expect(loc.code).toBe('FT301');
    expect(loc.buildingCode).toBe('FT');
    expect(loc.buildingName).toBe('Polaris');
    expect(loc.floor).toEqual({ kind: 'numbered', number: 3 });
    expect(loc.room).toBe('301');
    expect(roomDisplayText(loc)).toBe('Polaris, Room 301, Floor 3');
  });

  test('decodes ground, basement and extension', () => {
    const ground = parseRoom('GLA.CG86');
    expect(ground.buildingName).toBe('Henry Grattan');
    expect(ground.floor).toEqual({ kind: 'ground' });
    expect(ground.room).toBe('86');
    expect(parseRoom('GLA.SG23')).toMatchObject({ buildingName: 'Stokes', floor: { kind: 'ground' } });
    expect(parseRoom('GLA.SB39')).toMatchObject({ buildingName: 'Stokes', floor: { kind: 'basement' } });
    expect(parseRoom('GLA.SA101')).toMatchObject({
      buildingCode: 'SA', buildingName: 'Stokes Extension', floor: { kind: 'numbered', number: 1 },
    });
  });

  test('decodes other Glasnevin buildings', () => {
    expect(parseRoom('GLA.T101').buildingName).toBe('Terence Larkin Theatre');
    expect(parseRoom('GLA.XG28').buildingName).toBe('Lonsdale');
    expect(parseRoom('GLA.HG22').buildingName).toBe('Nursing Building');
    expect(parseRoom('GLA.QG15').buildingName).toBe('DCU Business School');
    expect(parseRoom('GLA.LG25').buildingName).toBe('McNulty');
  });

  test('handles compound room strings', () => {
    const loc = parseRoom('GLA.XG28 & XG28-A');
    expect(loc.code).toBe('XG28 & XG28-A');
    expect(loc.buildingName).toBe('Lonsdale');
    expect(loc.floor).toEqual({ kind: 'ground' });
  });

  test('does not invent names for other campuses', () => {
    const allHallows = parseRoom('AHC.CG01');
    expect(allHallows.campus).toBe('allHallows');
    expect(allHallows.code).toBe('CG01');
    expect(allHallows.buildingName).toBeNull();
    expect(roomDisplayText(allHallows)).toBe('CG01');
    const stPats = parseRoom('SPC.B101');
    expect(stPats.campus).toBe('stPatricks');
    expect(stPats.buildingName).toBeNull();
  });

  test('an event collapses several rooms', () => {
    const e = (rooms: string[]) => event('', new Date(), new Date(), { locations: rooms });
    expect(locationDisplay(e([]))).toBe('—');
    expect(locationDisplay(e(['GLA.FT301']))).toBe('Polaris, Room 301, Floor 3');
    expect(locationDisplay(e(['GLA.T101', 'GLA.HG22']))).toBe('Terence Larkin Theatre, Room 101 · Nursing Building, Room 22');
  });
});

describe('Lecturers and attendance', () => {
  test('reads surname-first names the way people do', () => {
    expect(lecturerDisplayName(makeLecturer('Harcourt, Stephen'))).toBe('Stephen Harcourt');
    expect(lecturerDisplayName(makeLecturer('Stephen Harcourt'))).toBe('Stephen Harcourt');
  });

  test('initials use first and last name', () => {
    expect(lecturerInitials(makeLecturer('Harcourt, Stephen'))).toBe('SH');
    expect(lecturerInitials(makeLecturer('Ó Briain, Seán'))).toBe('SB');
    expect(lecturerInitials(makeLecturer('Cher'))).toBe('C');
    expect(lecturerInitials(makeLecturer(''))).toBe('?');
  });

  test('toggling adds then removes', () => {
    const key = 'EEG1001|2026-09-17T09:00:00Z';
    const once = Attendance.toggling(key, []);
    expect(once).toEqual([key]);
    expect(Attendance.toggling(key, once)).toEqual([]);
  });
});

describe('Clash detection', () => {
  const e = (id: string, from: number, to: number) => event('', new Date(from * 3600_000), new Date(to * 3600_000), { id });

  test('detects an overlapping pair', () => {
    const events = [e('a', 9, 11), e('b', 10, 12), e('c', 13, 14)];
    expect(ClashDetector.clashes(events)).toHaveLength(1);
    expect(ClashDetector.clashingEventIDs(events)).toEqual(new Set(['a', 'b']));
  });
  test('adjacent events do not clash', () => expect(ClashDetector.clashes([e('a', 9, 10), e('b', 10, 11)])).toHaveLength(0));
  test('detects a triple overlap', () => {
    const events = [e('a', 9, 12), e('b', 10, 11), e('c', 11, 13)];
    expect(ClashDetector.clashes(events)).toHaveLength(2);
    expect(ClashDetector.clashingEventIDs(events)).toEqual(new Set(['a', 'b', 'c']));
  });
  test('empty input has no clashes', () => expect(ClashDetector.clashes([])).toHaveLength(0));
});

describe('Week grid', () => {
  const e = (id: string, from: number, to: number) => event('', new Date(from * 3600_000), new Date(to * 3600_000), { id });

  test('sequential classes each take full width', () => {
    const placed = WeekGrid.place([e('a', 9, 10), e('b', 10, 11), e('c', 13, 14)]);
    expect(placed).toHaveLength(3);
    expect(placed.every((p) => p.columnCount === 1 && p.column === 0)).toBe(true);
  });
  test('overlapping classes split into columns', () => {
    const placed = WeekGrid.place([e('a', 9, 11), e('b', 10, 12)]);
    expect(placed.every((p) => p.columnCount === 2)).toBe(true);
    expect(new Set(placed.map((p) => p.column))).toEqual(new Set([0, 1]));
  });
  test('a cluster reuses a freed column', () => {
    const placed = WeekGrid.place([e('a', 9, 11), e('b', 10, 12), e('c', 11, 13)]);
    expect(placed.every((p) => p.columnCount === 2)).toBe(true);
    const byID = Object.fromEntries(placed.map((p) => [p.event.id, p.column]));
    expect(byID).toEqual({ a: 0, b: 1, c: 0 });
  });
  test('separate clusters are independent', () => {
    const placed = WeekGrid.place([e('a', 9, 11), e('b', 10, 12), e('c', 15, 16)]);
    const byID = Object.fromEntries(placed.map((p) => [p.event.id, p.columnCount]));
    expect(byID.a).toBe(2);
    expect(byID.c).toBe(1);
  });
  test('an empty day places nothing', () => expect(WeekGrid.place([])).toHaveLength(0));
});

describe('Day schedule', () => {
  const t = (hour: number, minute = 0) => at(2026, 9, 18, hour, minute);
  const e = (id: string, from: Date, to: Date) => event('EEG1001[1]L1', from, to, { id });
  const gaps = (slots: DaySlot[]) => slots.flatMap((s) => (s.kind === 'gap' ? [s.gap] : []));

  test('fills the space between classes', () => {
    const slots = DaySchedule.slots([e('a', t(9), t(10)), e('b', t(13), t(14))]);
    expect(slots.map((s) => (s.kind === 'session' ? s.event.id : 'gap'))).toEqual(['a', 'gap', 'b']);
    expect(gaps(slots).map(gapLabel)).toEqual(['3 hours free']);
  });
  test('a long gap is a single condensed row', () => {
    const slots = DaySchedule.slots([e('a', t(9), t(10)), e('b', t(15), t(16))]);
    expect(gaps(slots)).toHaveLength(1);
    expect(gapLabel(gaps(slots)[0])).toBe('5 hours free');
  });
  test('ignores the walk between rooms', () => {
    expect(gaps(DaySchedule.slots([e('a', t(9), t(10)), e('b', t(10), t(11))]))).toHaveLength(0);
    expect(gaps(DaySchedule.slots([e('a', t(9), t(9, 50)), e('b', t(10), t(11))]))).toHaveLength(0);
    expect(gaps(DaySchedule.slots([e('a', t(9), t(9, 45)), e('b', t(10), t(11))])).map(gapLabel)).toEqual(['15 min free']);
  });
  test('overlapping classes do not invent a gap', () => {
    const slots = DaySchedule.slots([e('long', t(9), t(12)), e('short', t(10), t(11)), e('after', t(13), t(14))]);
    expect(gaps(slots)).toHaveLength(1);
    expect(gaps(slots)[0].start).toEqual(t(12));
    expect(gapLabel(gaps(slots)[0])).toBe('1 hour free');
  });
  test('nothing is added before the first or after the last', () => {
    const slots = DaySchedule.slots([e('only', t(11), t(12))]);
    expect(slots).toHaveLength(1);
    expect(DaySchedule.slots([])).toHaveLength(0);
  });
  test('words the duration the way a student would say it', () => {
    expect(DaySchedule.freeLabel(20)).toBe('20 min free');
    expect(DaySchedule.freeLabel(60)).toBe('1 hour free');
    expect(DaySchedule.freeLabel(120)).toBe('2 hours free');
    expect(DaySchedule.freeLabel(150)).toBe('2 hr 30 min free');
  });
  test('totals the free time for the day header', () => {
    const slots = DaySchedule.slots([e('a', t(9), t(10)), e('b', t(12), t(13)), e('c', t(16), t(17))]);
    expect(DaySchedule.freeMinutes(slots)).toBe(300);
  });
});

describe('Default day', () => {
  const monday = at(2026, 9, 14);
  const target = (day: number, hour: number, weekStart = monday) => DefaultDay.target(weekStart, at(2026, 9, day, hour));

  test('opens on today during the day', () => {
    expect(target(14, 9)).toEqual({ weekStep: 0, dayIndex: 0 });
    expect(target(16, 13)).toEqual({ weekStep: 0, dayIndex: 2 });
    expect(target(16, 17)).toEqual({ weekStep: 0, dayIndex: 2 });
  });
  test('rolls over to tomorrow from 6pm', () => {
    expect(target(16, 18)).toEqual({ weekStep: 0, dayIndex: 3 });
    expect(target(16, 23)).toEqual({ weekStep: 0, dayIndex: 3 });
    expect(target(14, 20)).toEqual({ weekStep: 0, dayIndex: 1 });
  });
  test('Friday evening and weekends go to next Monday', () => {
    expect(target(18, 9)).toEqual({ weekStep: 0, dayIndex: 4 });
    expect(target(18, 19)).toEqual({ weekStep: 1, dayIndex: 0 });
    expect(target(19, 11)).toEqual({ weekStep: 1, dayIndex: 0 });
    expect(target(20, 21)).toEqual({ weekStep: 1, dayIndex: 0 });
  });
  test('settles after stepping a week', () => {
    const nextMonday = at(2026, 9, 21);
    expect(target(18, 19, nextMonday)).toEqual({ weekStep: 0, dayIndex: 0 });
    expect(target(20, 21, nextMonday)).toEqual({ weekStep: 0, dayIndex: 0 });
  });
  test('paged away lands on Monday without moving', () => {
    expect(target(16, 13, at(2026, 9, 28))).toEqual({ weekStep: 0, dayIndex: 0 });
    expect(target(16, 13, at(2026, 9, 7))).toEqual({ weekStep: 0, dayIndex: 0 });
  });
});

describe('Next class window', () => {
  const t = (hour: number, minute = 0) => at(2026, 9, 23, hour, minute);
  const twoHour = { id: 'lecture', start: t(9), end: t(11) };
  const lab = { id: 'lab', start: t(10), end: t(11) };

  test('the window opens half the class length before it starts', () => expect(NextClassWindow.window(twoHour).lower).toEqual(t(8)));
  test('the window closes when the class is half over', () => expect(NextClassWindow.window(twoHour).upper).toEqual(t(10)));
  test('nothing before the window opens', () => expect(NextClassWindow.highlighted([twoHour], t(7, 59))).toBeNull());
  test('highlighted from the moment the window opens', () => {
    expect(NextClassWindow.highlighted([twoHour], t(8))?.id).toBe('lecture');
    expect(NextClassWindow.highlighted([twoHour], t(9, 30))?.id).toBe('lecture');
  });
  test('nothing once the class is half over', () => {
    expect(NextClassWindow.highlighted([twoHour], t(10))).toBeNull();
    expect(NextClassWindow.highlighted([twoHour], t(10, 30))).toBeNull();
  });
  test('the highlight moves to the next class while the current one runs', () => {
    expect(NextClassWindow.highlighted([twoHour, lab], t(9, 10))?.id).toBe('lecture');
    expect(NextClassWindow.highlighted([twoHour, lab], t(9, 45))?.id).toBe('lab');
  });
  test('order in the array does not decide it', () => {
    expect(NextClassWindow.highlighted([twoHour, lab], t(9, 45))?.id).toBe(NextClassWindow.highlighted([lab, twoHour], t(9, 45))?.id);
  });
  test('a zero-length class still gets a window', () => {
    const broken = { id: 'broken', start: t(12), end: t(12) };
    expect(NextClassWindow.highlighted([broken], t(12))?.id).toBe('broken');
    expect(NextClassWindow.highlighted([broken], t(11, 57))?.id).toBe('broken');
  });
  test('nothing on a day with no classes', () => expect(NextClassWindow.highlighted([], t(9))).toBeNull());
});

describe('Pagers', () => {
  const weeks = 52;
  test('week 1 has nothing before it', () => {
    expect(PagerIndex.resolve(-1, weeks, 'clamped')).toBeNull();
    expect(PagerIndex.step(0, -1, weeks, 'clamped')).toBe(0);
    expect(PagerIndex.canStep(0, -1, weeks, 'clamped')).toBe(false);
  });
  test('the last week has nothing after it', () => {
    expect(PagerIndex.resolve(weeks, weeks, 'clamped')).toBeNull();
    expect(PagerIndex.step(51, 1, weeks, 'clamped')).toBe(51);
    expect(PagerIndex.canStep(51, 1, weeks, 'clamped')).toBe(false);
  });
  test('steps normally in the middle', () => {
    expect(PagerIndex.step(10, 1, weeks, 'clamped')).toBe(11);
    expect(PagerIndex.step(10, -1, weeks, 'clamped')).toBe(9);
    expect(PagerIndex.canStep(0, 1, weeks, 'clamped')).toBe(true);
    expect(PagerIndex.canStep(51, -1, weeks, 'clamped')).toBe(true);
    expect(PagerIndex.resolve(0, weeks, 'clamped')).toBe(0);
    expect(PagerIndex.resolve(51, weeks, 'clamped')).toBe(51);
  });
  test('a big step stops at the edge', () => {
    expect(PagerIndex.step(3, -10, weeks, 'clamped')).toBe(0);
    expect(PagerIndex.step(48, 10, weeks, 'clamped')).toBe(51);
  });
  test('days still wrap within the week', () => {
    expect(PagerIndex.resolve(-1, 5, 'wrapping')).toBe(4);
    expect(PagerIndex.resolve(5, 5, 'wrapping')).toBe(0);
    expect(PagerIndex.step(0, -1, 5, 'wrapping')).toBe(4);
    expect(PagerIndex.step(4, 1, 5, 'wrapping')).toBe(0);
    expect(PagerIndex.canStep(0, -1, 5, 'wrapping')).toBe(true);
  });
  test('the day pager runs Friday into the next Monday and back', () => {
    const friday = WeekdayIndex.flat(3, 4);
    expect(WeekdayIndex.split(friday + 1)).toEqual({ week: 4, day: 0 });
    expect(WeekdayIndex.split(WeekdayIndex.flat(4, 0) - 1)).toEqual({ week: 3, day: 4 });
    expect(PagerIndex.resolve(-1, weeks * 5, 'clamped')).toBeNull();
    expect(PagerIndex.resolve(weeks * 5, weeks * 5, 'clamped')).toBeNull();
  });
  test('an empty pager asks for nothing', () => {
    for (const bounds of ['clamped', 'wrapping'] as const) {
      expect(PagerIndex.resolve(0, 0, bounds)).toBeNull();
      expect(PagerIndex.step(0, 1, 0, bounds)).toBe(0);
      expect(PagerIndex.canStep(0, 1, 0, bounds)).toBe(false);
    }
  });
  test('a single page goes nowhere', () => {
    for (const bounds of ['clamped', 'wrapping'] as const) {
      expect(PagerIndex.canStep(0, 1, 1, bounds)).toBe(false);
      expect(PagerIndex.canStep(0, -1, 1, bounds)).toBe(false);
    }
  });

  test('taps pass through when nobody is swiping', () => expect(new PagerDragState().isSuppressingTaps()).toBe(false));
  test('taps are blocked during a swipe', () => {
    const s = new PagerDragState();
    s.begin();
    expect(s.isSuppressingTaps()).toBe(true);
  });
  test('taps are blocked for a moment after a swipe', () => {
    const s = new PagerDragState();
    const end = Date.now();
    s.begin();
    s.end(end);
    expect(s.isSuppressingTaps(end)).toBe(true);
    expect(s.isSuppressingTaps(end + 100)).toBe(true);
    expect(s.isSuppressingTaps(end + PagerDragState.tapBlackoutMs)).toBe(false);
    expect(s.isSuppressingTaps(end + 1000)).toBe(false);
  });
  test('a second swipe blocks again', () => {
    const s = new PagerDragState();
    s.end(Date.now() - 10_000);
    expect(s.isSuppressingTaps()).toBe(false);
    s.begin();
    expect(s.isSuppressingTaps()).toBe(true);
  });
});

describe('Time', () => {
  test('Dublin is UTC+1 in summer and UTC in winter', () => {
    expect(DublinTime.timeString(utc(2026, 10, 14, 13))).toBe('14:00');
    expect(DublinTime.timeString(utc(2026, 12, 1, 13))).toBe('13:00');
    expect(DublinTime.date('2026-10-14', '14:00')).toEqual(utc(2026, 10, 14, 13));
    expect(DublinTime.date('2026-12-01', '14:00')).toEqual(utc(2026, 12, 1, 14));
  });

  test('the clock changes on the last Sundays of March and October at 01:00 UTC', () => {
    // 2026: 29 March and 25 October.
    expect(DublinTime.offsetMinutes(utc(2026, 3, 29, 0, 59))).toBe(0);
    expect(DublinTime.offsetMinutes(utc(2026, 3, 29, 1))).toBe(60);
    expect(DublinTime.offsetMinutes(utc(2026, 10, 25, 0, 59))).toBe(60);
    expect(DublinTime.offsetMinutes(utc(2026, 10, 25, 1))).toBe(0);
    expect(DublinTime.dateString(utc(2026, 10, 13, 23, 30))).toBe('2026-10-14');
  });

  test('Dublin time agrees with the system time-zone database all year', () => {
    // The test process runs in Europe/Dublin, so the engine's own answer is the reference.
    for (let day = 0; day < 366; day++) {
      for (const hour of [0, 1, 2, 12, 23]) {
        const instant = new Date(Date.UTC(2026, 0, 1 + day, hour, 30));
        expect(DublinTime.offsetMinutes(instant)).toBe(0 - instant.getTimezoneOffset());
      }
    }
  });

  test('reads ISO timestamps with any fraction and offset', () => {
    expect(parseISO('2026-09-15T13:30:00+00:00')).toEqual(utc(2026, 9, 15, 13, 30));
    expect(parseISO('2026-09-15T13:30:00Z')).toEqual(utc(2026, 9, 15, 13, 30));
    expect(parseISO('2026-09-15T14:30:00.123456+01:00')?.getTime()).toBe(utc(2026, 9, 15, 13, 30).getTime() + 123);
    expect(parseISO('not a date')).toBeNull();
    expect(isoSeconds(utc(2026, 9, 16, 9))).toBe('2026-09-16T09:00:00Z');
  });
});


describe('Group catalog', () => {
  const e = (code: string, moduleName: string | null = null) => event(code, new Date(), undefined, { moduleName });

  test('offers only choosable streams, not lectures', () => {
    const modules = GroupCatalog.modules([
      e('EEG1001[1]OC/L1/01', 'Project & Technical Drawing'),
      e('EEG1001[1]OC/P1/01', 'Project & Technical Drawing'),
      e('EEG1001[1]OC/P2/01', 'Project & Technical Drawing'),
      e('EEG1001[1]OC/P1/01', 'Project & Technical Drawing'),
    ]);
    expect(modules).toHaveLength(1);
    expect(modules[0].moduleCode).toBe('EEG1001');
    expect(modules[0].groups).toHaveLength(2);
  });

  test('a module with only lectures is omitted', () => {
    expect(GroupCatalog.modules([e('EEG1006[1]OC/L1/01'), e('EEG1006[1]OC/L2/01')])).toHaveLength(0);
  });

  test('surname splits are distinct groups', () => {
    const modules = GroupCatalog.modules([e('BIO1000[1]OC/T1/01 Surname A - M', 'How life works 1'), e('BIO1000[1]OC/T1/01 Surname N - Z', 'How life works 1')]);
    expect(modules[0].groups).toHaveLength(2);
  });

  test('the filter hides selected groups, and nothing when none are hidden', () => {
    const p1 = e('EEG1001[1]OC/P1/01');
    const p2 = e('EEG1001[1]OC/P2/01');
    expect(GroupCatalog.filter([p1, p2], new Set([groupKeyOf(p2)])).map(groupKeyOf)).toEqual([groupKeyOf(p1)]);
    expect(GroupCatalog.filter([p1], new Set())).toHaveLength(1);
  });
});


describe('Lecturer directory', () => {
  test('without a directory there is no photo, only initials', () => {
    const lecturer = new LecturerDirectory([]).lecturer('Harcourt, Stephen');
    expect(lecturer.photoURL).toBeNull();
    expect(lecturerInitials(lecturer)).toBe('SH');
  });

  test('names match regardless of order and punctuation', () => {
    const dir = new LecturerDirectory([{ name: 'Stephen Harcourt', photo: 'https://x/p.jpg', role: 'Assistant Professor' }]);
    expect(dir.lecturer('Harcourt, Stephen')).toEqual({ name: 'Harcourt, Stephen', photoURL: 'https://x/p.jpg', role: 'Assistant Professor' });
    expect(dir.lecturer('Someone Else').photoURL).toBeNull();
  });
});
