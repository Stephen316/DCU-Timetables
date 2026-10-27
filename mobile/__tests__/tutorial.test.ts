import { readFileSync } from 'fs';
import { join } from 'path';
import { Tutorial, TutorialText } from '../src/core/tutorial';
import { Safari } from '../src/data/safari';
import { createServices } from '../src/data/services';
import { MemoryKV } from '../src/data/storage';
import { LectureModel } from '../src/features/lecture/LectureModel';
import { at, event } from './helpers';

const phone = Tutorial.steps(false);
const mac = Tutorial.steps(true);
const safari = Tutorial.steps(false, true);

describe('Tutorial steps', () => {
  test('the phone tour runs forward: day, week, a class and back, Deadlines, More, then the end', () => {
    expect(phone.map((s) => s.id)).toEqual([
      'welcome', 'day', 'swipe', 'week', 'class', 'report', 'undo', 'back', 'deadlines', 'deadlinesPage', 'more', 'menu', 'thanks',
    ]);
    expect(Tutorial.position(phone, 0)).toEqual({ n: 1, total: 8 });
    const at = (id: string) => Tutorial.position(phone, phone.findIndex((s) => s.id === id));
    // Reporting, undoing and going back are all part of "Tap a class".
    for (const id of ['class', 'report', 'undo', 'back']) expect(at(id)).toEqual({ n: 5, total: 8 });
    expect(at('thanks')).toEqual({ n: 8, total: 8 });
  });

  test('every control the tour points at, the student presses: those steps have no Next', () => {
    for (const s of [...phone, ...mac]) {
      if (s.action === 'tap') {
        expect(s.primary).toBeNull();
        expect(s.advancesOn).not.toBeNull();
      }
    }
    // A swipe isn't a button, so Next still stands in for it.
    expect(phone.find((s) => s.id === 'swipe')?.primary).toBe('Next');
  });

  test('reports are practice only on the class page, where they happen', () => {
    expect(phone.filter((s) => s.practice).map((s) => s.id)).toEqual(['report', 'undo']);
  });

  test('More and the end take the student to the timetable themselves, so nobody has to go back', () => {
    expect(phone.filter((s) => s.toTimetable).map((s) => s.id)).toEqual(['more', 'thanks']);
  });

  test("the Mac's tour never points at the day view, which it doesn't have", () => {
    const dayOnly = ['dayList', 'dayHeading', 'viewToggle'];
    expect(mac.some((s) => s.target && dayOnly.includes(s.target))).toBe(false);
    expect(mac.some((s) => s.action === 'swipeLeft')).toBe(false);
    expect(Tutorial.position(mac, mac.length - 1)).toEqual({ n: 6, total: 6 });
  });

  test('the last card is left by Done, with no Skip beside it to do the same', () => {
    for (const steps of [phone, mac]) {
      expect(steps[steps.length - 1].primary).toBe('Done');
      expect(steps[steps.length - 1].skip).toBeNull();
    }
  });

  test('doing the action goes on to the step that follows; skipping one skips what continues it', () => {
    const index = (id: string) => phone.findIndex((s) => s.id === id);
    expect(phone[Tutorial.next(phone, index('class'), true)].id).toBe('report');
    // The week's empty, so no class to open: on to Deadlines.
    expect(phone[Tutorial.next(phone, index('class'), false)].id).toBe('deadlines');
    // Nothing to report (already reported, say): still back out of the class's page.
    expect(phone[Tutorial.next(phone, index('report'), false)].id).toBe('back');
    expect(phone[Tutorial.next(phone, index('swipe'), false)].id).toBe('week');
  });

  test('in Safari on an iPhone, the tour shows adding it to the Home Screen just before the end', () => {
    expect(safari.map((s) => s.id)).toEqual([...phone.slice(0, -1).map((s) => s.id), 'homeScreen', 'thanks']);
    expect(Tutorial.position(safari, safari.length - 2)).toEqual({ n: 8, total: 9 });
    expect(safari.filter((s) => s.media).map((s) => s.id)).toEqual(['homeScreen']);
    // Nowhere else: the Mac app and the native app are already apps.
    expect([...phone, ...mac].some((s) => s.media)).toBe(false);
    expect(Tutorial.steps(true, true)).toBe(mac);
  });
});

describe('Safari on an iPhone', () => {
  const ua = (rest: string) => `Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ${rest}`;

  test('is Safari itself', () => {
    expect(Safari.isIPhoneSafari(ua('Version/26.0 Mobile/15E148 Safari/604.1'))).toBe(true);
  });

  test("is not another browser, whose Share is elsewhere, nor an app's own browser, which can't add to the Home Screen", () => {
    expect(Safari.isIPhoneSafari(ua('CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1'))).toBe(false);
    expect(Safari.isIPhoneSafari(ua('FxiOS/143.0 Mobile/15E148 Safari/605.1.15'))).toBe(false);
    expect(Safari.isIPhoneSafari(ua('Version/26.0 EdgiOS/140.3485.94 Mobile/15E148 Safari/605.1.15'))).toBe(false);
    expect(Safari.isIPhoneSafari(ua('Mobile/15E148 Instagram 401.0.0.32.75 (iPhone17,1; iOS 26_0)'))).toBe(false);
    expect(Safari.isIPhoneSafari(ua('Mobile/15E148 [FBAN/FBIOS;FBAV/530.0.0.47.109]'))).toBe(false);
  });

  test('is not an iPad or a Mac, where Share is at the top', () => {
    expect(Safari.isIPhoneSafari('Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1')).toBe(false);
    expect(Safari.isIPhoneSafari('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15')).toBe(false);
  });
});

describe('The tutorial text file', () => {
  // docs/TUTORIAL_TEXT.txt is where the words are edited; the code must say what it says.
  const file = readFileSync(join(__dirname, '../../docs/TUTORIAL_TEXT.txt'), 'utf8');
  const lines = new Set(file.split('\n').map((l) => l.replace(/\s+\(drafted by Claude.*\)\s*$/, '').trim()));

  test.each([...safari, ...mac].map((s) => [s.id, s] as const))('%s matches the file', (_, s) => {
    expect(lines).toContain(`TITLE: ${s.title}`);
    if (s.body) expect(lines).toContain(`BODY: ${s.body}`);
    if (s.arrived) {
      expect(lines).toContain(`TITLE: ${s.arrived.title}`);
      if (s.arrived.body) expect(lines).toContain(`BODY: ${s.arrived.body}`);
    }
  });

  test('the card and Account wording match the file', () => {
    expect(lines).toContain(`SKIP LINK: ${TutorialText.skip}`);
    expect(lines).toContain(`NEXT BUTTON: ${TutorialText.next}`);
    expect(lines).toContain(`ROW: ${TutorialText.replay}`);
  });
});

describe("The tutorial's practice report", () => {
  test('changes only what the class page shows, and is undone without a request either way', async () => {
    const services = await createServices({ kv: new MemoryKV(), secrets: { get: async () => null, set: async () => {}, remove: async () => {} }, env: {} });
    const submit = jest.spyOn(services.cancellations, 'submit');
    const withdraw = jest.spyOn(services.cancellations, 'withdraw');
    const model = new LectureModel(services, event('MS121[1]OC/L1/01', at(2026, 10, 12, 9)));

    model.setPractice(true);
    await model.report('cancelled');
    expect(model.status.myStance).toBe('cancelled');
    expect(model.status.reportCount).toBe(1);
    await model.withdrawReport();
    expect(model.status.myStance).toBeNull();
    expect(model.status.reportCount).toBe(0);
    expect(submit).not.toHaveBeenCalled();
    expect(withdraw).not.toHaveBeenCalled();

    // Outside the tour, a report is a report.
    model.setPractice(false);
    await model.report('cancelled');
    expect(submit).toHaveBeenCalledTimes(1);
  });
});

describe("A moderator's practice verdict", () => {
  test('marks the class cancelled on this page only, and marking it on puts it back', async () => {
    const services = await createServices({ kv: new MemoryKV(), secrets: { get: async () => null, set: async () => {}, remove: async () => {} }, env: {} });
    const set = jest.spyOn(services.verdicts, 'set');
    const model = new LectureModel(services, event('MS121[1]OC/L1/01', at(2026, 10, 12, 9)));
    model.setPractice(true);
    await model.decide('cancelled');
    expect(model.status.verdict?.state).toBe('cancelled');
    await model.decide('running');
    expect(model.status.verdict).toBeNull();
    expect(set).not.toHaveBeenCalled();
  });
});
