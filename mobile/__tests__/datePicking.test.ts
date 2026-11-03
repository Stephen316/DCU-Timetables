import { DatePicking } from '../src/core/datePicking';
import { at } from './helpers';

describe('The due-date calendar', () => {
  test('lays a month out Monday first, padding the first and last weeks', () => {
    // October 2026 starts on a Thursday and has 31 days.
    const weeks = DatePicking.monthGrid(2026, 9);
    expect(weeks[0].slice(0, 3)).toEqual([null, null, null]);
    expect(weeks[0][3]?.getDate()).toBe(1);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks.flat().filter(Boolean)).toHaveLength(31);
    expect(weeks[weeks.length - 1].filter(Boolean).pop()?.getDate()).toBe(31);
  });

  test('a month that starts on a Monday has no padding before it', () => {
    // June 2026 starts on a Monday.
    expect(DatePicking.monthGrid(2026, 5)[0][0]?.getDate()).toBe(1);
  });

  test('steps across a year end', () => {
    expect(DatePicking.stepMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(DatePicking.stepMonth(2027, 0, -1)).toEqual({ year: 2026, month: 11 });
  });

  test('picking a day keeps the time, and picking a time keeps the day', () => {
    const due = at(2026, 10, 14, 17, 30);
    expect(DatePicking.withDay(due, at(2026, 10, 20))).toEqual(at(2026, 10, 20, 17, 30));
    expect(DatePicking.withTime(due, 9, 5)).toEqual(at(2026, 10, 14, 9, 5));
  });
});

describe('The time wheels', () => {
  test('repeat their values an odd number of times, enough to fling through', () => {
    for (const count of [24, 60]) {
      const copies = DatePicking.wheelCopies(count);
      expect(copies % 2).toBe(1);
      expect(copies * count).toBeGreaterThanOrEqual(600);
    }
  });

  test('open on the value in the middle copy, and read it back from any copy', () => {
    const row = DatePicking.wheelRow(17, 24);
    const copies = DatePicking.wheelCopies(24);
    expect(Math.floor(row / 24)).toBe(Math.floor(copies / 2));
    expect(DatePicking.wheelValue(row, 24)).toBe(17);
    expect(DatePicking.wheelValue(row + 24 * 3, 24)).toBe(17);
    expect(DatePicking.wheelValue(row - 1, 24)).toBe(16);
    expect(DatePicking.wheelRow(-1, 60)).toBe(DatePicking.wheelRow(59, 60));
  });

  test('come to rest on the nearest row, never off either end', () => {
    expect(DatePicking.restingRow(119, 40, 600)).toBe(3);
    expect(DatePicking.restingRow(101, 40, 600)).toBe(3);
    expect(DatePicking.restingRow(-80, 40, 600)).toBe(0);
    expect(DatePicking.restingRow(1e6, 40, 600)).toBe(599);
  });

  test('step round the loop', () => {
    expect(DatePicking.stepWheel(23, 1, 24)).toBe(0);
    expect(DatePicking.stepWheel(0, -1, 60)).toBe(59);
    expect(DatePicking.stepWheel(30, 1, 60)).toBe(31);
  });
});
