/**
 * The arithmetic behind the due-date popups: a month laid out as a calendar page, and the
 * looping hour and minute wheels. No views, so it can be tested.
 */
export const DatePicking = {
  /**
   * A month as weeks of seven days, Monday first, as Irish calendars print it. Days outside
   * the month are null, so the first row starts on the right weekday.
   */
  monthGrid(year: number, month: number): (Date | null)[][] {
    const first = new Date(year, month, 1);
    const lead = (first.getDay() + 6) % 7; // Monday = 0
    const days = new Date(year, month + 1, 0).getDate();
    const cells: (Date | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => new Date(year, month, i + 1))];
    while (cells.length % 7 !== 0) cells.push(null);
    return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
  },

  /** The month after (`1`) or before (`-1`) another, across a year end. */
  stepMonth(year: number, month: number, step: number): { year: number; month: number } {
    const d = new Date(year, month + step, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  },

  /** `value` moved to `day`, keeping its time. */
  withDay(value: Date, day: Date): Date {
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), value.getHours(), value.getMinutes());
  },

  /** `value` at `hours`:`minutes` on the same day. */
  withTime(value: Date, hours: number, minutes: number): Date {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate(), hours, minutes);
  },

  /**
   * How many times a time wheel repeats its values. The wheels loop as Clock's do: the
   * values are laid end to end many times over, and a wheel that comes to rest is moved back
   * to the same value in the middle copy. Odd, so there is a middle; long enough — about
   * `WHEEL_ROWS` rows — that no fling reaches either end.
   */
  wheelCopies(count: number): number {
    const copies = Math.ceil(WHEEL_ROWS / count);
    return copies % 2 === 1 ? copies : copies + 1;
  },

  /** The row that shows `value` in the middle copy of a wheel of `count` values. */
  wheelRow(value: number, count: number): number {
    return Math.floor(DatePicking.wheelCopies(count) / 2) * count + wrap(value, count);
  },

  /** The value a row shows, whichever copy it's in. */
  wheelValue(row: number, count: number): number {
    return wrap(row, count);
  },

  /** The row a wheel has come to rest on at `offset`: the nearest one, kept on the wheel. */
  restingRow(offset: number, rowHeight: number, rows: number): number {
    return Math.min(Math.max(Math.round(offset / rowHeight), 0), rows - 1);
  },

  /** `value` moved `by` rows, round the loop: one up from 23 is 00, one down from 00 is 59. */
  stepWheel(value: number, by: number, count: number): number {
    return wrap(value + by, count);
  },
};

/** Rows on a time wheel, give or take a copy of its values. */
const WHEEL_ROWS = 600;

/** `n` folded into 0..count-1, negatives included. */
function wrap(n: number, count: number): number {
  return ((n % count) + count) % count;
}
