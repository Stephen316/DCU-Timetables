import { readFileSync } from 'fs';
import { join } from 'path';
import { Tutorial, TutorialText } from '../src/core/tutorial';

const phone = Tutorial.steps(false);
const mac = Tutorial.steps(true);

describe('Tutorial steps', () => {
  test('the phone tour has eight numbered steps, the report card counting as part of "Tap a class"', () => {
    expect(phone.map((s) => s.id)).toEqual(['welcome', 'day', 'swipe', 'week', 'class', 'report', 'more', 'deadlines', 'thanks']);
    expect(Tutorial.position(phone, 0)).toEqual({ n: 1, total: 8 });
    expect(Tutorial.position(phone, 4)).toEqual({ n: 5, total: 8 });
    expect(Tutorial.position(phone, 5)).toEqual({ n: 5, total: 8 });
    expect(Tutorial.position(phone, 8)).toEqual({ n: 8, total: 8 });
  });

  test("the Mac's tour never points at the day view, which it doesn't have", () => {
    const dayOnly = ['dayHeading', 'viewToggle', 'reportSection'];
    expect(mac.some((s) => s.target && dayOnly.includes(s.target))).toBe(false);
    expect(mac.some((s) => s.action !== null)).toBe(false);
    expect(Tutorial.position(mac, mac.length - 1)).toEqual({ n: 5, total: 5 });
    expect(mac[mac.length - 1].primary).toBe('Done');
    // The last card's way out is Done; a Skip beside it would do the same thing.
    expect(phone[phone.length - 1].skip).toBeNull();
    expect(mac[mac.length - 1].skip).toBeNull();
  });

  test('doing the action goes on to the step that follows it; Next instead skips that step', () => {
    const tap = phone.findIndex((s) => s.id === 'class');
    expect(phone[Tutorial.next(phone, tap, true)].id).toBe('report');
    expect(phone[Tutorial.next(phone, tap, false)].id).toBe('more');
    const swipe = phone.findIndex((s) => s.id === 'swipe');
    expect(phone[Tutorial.next(phone, swipe, false)].id).toBe('week');
  });

  test('every action step says what completes it, and only the class step leaves the timetable', () => {
    for (const s of phone) {
      if (s.action === 'swipeLeft' || s.action === 'tap') expect(s.advancesOn).not.toBeNull();
      expect(s.screen === 'class').toBe(s.id === 'report');
    }
  });
});

describe('The tutorial text file', () => {
  // docs/TUTORIAL_TEXT.txt is where the words are edited; the code must say what it says.
  const file = readFileSync(join(__dirname, '../../docs/TUTORIAL_TEXT.txt'), 'utf8');
  const lines = new Set(file.split('\n').map((l) => l.replace(/\s+\(drafted by Claude.*\)\s*$/, '').trim()));

  test.each([...phone, ...mac].map((s) => [s.id, s] as const))('%s matches the file', (_, s) => {
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
