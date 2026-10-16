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

describe('The time dial', () => {
  test('puts 1–12 round the edge and 13–00 inside, each under its twelve-hour twin', () => {
    expect(DatePicking.hourPlace(3)).toEqual({ angle: 90, inner: false });
    expect(DatePicking.hourPlace(15)).toEqual({ angle: 90, inner: true });
    expect(DatePicking.hourPlace(12)).toEqual({ angle: 0, inner: false });
    expect(DatePicking.hourPlace(0)).toEqual({ angle: 0, inner: true });
    const all = [...DatePicking.hours.outer, ...DatePicking.hours.inner].sort((a, b) => a - b);
    expect(all).toEqual(Array.from({ length: 24 }, (_, h) => h));
  });

  test('minutes sit where a clock puts them, in fives', () => {
    expect(DatePicking.minuteAngle(15)).toBe(90);
    expect(DatePicking.minuteAngle(45)).toBe(270);
    expect(DatePicking.minutes).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  });

  test('places a mark on its ring clockwise from the top', () => {
    const p = DatePicking.point(90, 100);
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(0);
    expect(DatePicking.point(0, 100).y).toBeCloseTo(-100);
  });
});
