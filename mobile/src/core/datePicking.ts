/**
 * The arithmetic behind the due-date popups: a month laid out as a calendar page, and where
 * each hour and minute sits on the clock-face dial. No views, so it can be tested.
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
   * Where an hour sits on a 24-hour dial, in degrees clockwise from the top: 1–12 round the
   * outside as on any clock, 13–23 and 00 on a ring inside, each beneath its 12-hour twin.
   */
  hourPlace(hour: number): { angle: number; inner: boolean } {
    const inner = hour === 0 || hour > 12;
    return { angle: (hour % 12) * 30, inner };
  },

  /** Where a minute sits on the dial: the hour marks are every five minutes. */
  minuteAngle(minute: number): number {
    return (minute % 60) * 6;
  },

  /** The dial's hours, in the order they're drawn round each ring. */
  hours: { outer: [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], inner: [0, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23] },
  /** The dial's minutes, in five-minute steps. */
  minutes: Array.from({ length: 12 }, (_, i) => i * 5),

  /** A point on a ring of `radius`, at `angle` degrees clockwise from the top, from the centre. */
  point(angle: number, radius: number): { x: number; y: number } {
    const radians = (angle * Math.PI) / 180;
    return { x: Math.sin(radians) * radius, y: -Math.cos(radians) * radius };
  },
};
