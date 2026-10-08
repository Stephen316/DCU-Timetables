// No `server-only`: pure types and pure functions, no key and no database. The app will
// need the same boundary logic eventually, and logic that only exists inside a server
// module is logic that gets reimplemented slightly differently elsewhere.

/// One band of an alphabetical split: "surnames A-M are here at this time".
///
/// `from`/`to` are single uppercase letters, inclusive at both ends. Inclusive because that
/// is what everyone means by "A to M" out loud, and a half-open range silently loses every
/// student whose surname begins with M.
export type SplitRange = {
  from: string;
  to: string;
  day: string;
  start: string;
  end: string;
  room: string | null;
  label: string | null;
};

export type SplitRule = {
  moduleKey: string;
  /// What kind of session this split governs — a module often splits its tutorials but not
  /// its lectures, so this cannot be assumed.
  activity: string;
  ranges: SplitRange[];
};

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export type RuleProblem = { level: "error" | "warn"; message: string };

/// Everything that makes a split unusable, checked before it can be saved.
///
/// These matter more than they look. A split is applied silently on a student's phone: if
/// the bands leave a gap, someone opens the app and simply has no tutorial, with nothing
/// to indicate the rule is at fault rather than the timetable.
export function checkRule(rule: SplitRule): RuleProblem[] {
  const problems: RuleProblem[] = [];
  if (!rule.moduleKey) problems.push({ level: "error", message: "No module chosen." });
  if (rule.ranges.length === 0) {
    return [...problems, { level: "error", message: "No ranges — nothing to apply." }];
  }

  for (const r of rule.ranges) {
    const band = `${r.from}-${r.to}`;
    if (!LETTERS.includes(r.from) || !LETTERS.includes(r.to)) {
      problems.push({ level: "error", message: `${band}: ranges must be single letters A-Z.` });
      continue;
    }
    if (r.from > r.to) {
      problems.push({ level: "error", message: `${band} runs backwards.` });
    }
    if (!r.day || !r.start || !r.end) {
      problems.push({ level: "error", message: `${band}: missing day or time.` });
    }
  }
  if (problems.some((p) => p.level === "error")) return problems;

  // Every letter must land in exactly one band. Walking A-Z catches gaps and overlaps in
  // one pass, and reports them as letters rather than as intervals — "N is not covered" is
  // something you can act on; "range 2 does not abut range 3" is a puzzle.
  const owners = new Map<string, number>();
  rule.ranges.forEach((r, i) => {
    for (const L of LETTERS) if (L >= r.from && L <= r.to) {
      owners.set(L, (owners.get(L) ?? 0) + 1);
    }
    void i;
  });

  const uncovered = LETTERS.filter((L) => !owners.has(L));
  if (uncovered.length) {
    problems.push({
      level: "error",
      message: `Not covered: ${collapse(uncovered)}. Every surname needs a band.`,
    });
  }
  const doubled = LETTERS.filter((L) => (owners.get(L) ?? 0) > 1);
  if (doubled.length) {
    problems.push({
      level: "error",
      message: `In two bands at once: ${collapse(doubled)}.`,
    });
  }

  // Two bands at the same day and time are not an error — a module can run two rooms in
  // parallel — but it is worth surfacing, because it is usually a typo.
  const slots = new Map<string, string[]>();
  for (const r of rule.ranges) {
    const slot = `${r.day} ${r.start}`;
    slots.set(slot, [...(slots.get(slot) ?? []), `${r.from}-${r.to}`]);
  }
  for (const [slot, bands] of slots) {
    if (bands.length > 1) {
      problems.push({
        level: "warn",
        message: `${bands.join(" and ")} both sit at ${slot}. Intended?`,
      });
    }
  }
  return problems;
}

/// "A, B, C, G" reads worse than "A-C, G" when you are scanning for what went wrong.
function collapse(letters: string[]): string {
  const out: string[] = [];
  let i = 0;
  while (i < letters.length) {
    let j = i;
    while (j + 1 < letters.length &&
           LETTERS.indexOf(letters[j + 1]) === LETTERS.indexOf(letters[j]) + 1) j++;
    out.push(i === j ? letters[i] : `${letters[i]}-${letters[j]}`);
    i = j + 1;
  }
  return out.join(", ");
}

/// Which band a surname falls into.
///
/// Only the first letter matters, which is what makes this survive names that full-name
/// matching mangles: `rory.mcbride3@mail.dcu.ie` puts Mc Bride under M, where splitting a
/// written name on whitespace would read "Mc" as a forename.
///
/// Accents are stripped before comparing. A surname arriving from an email is already
/// flattened — `fionnan.obaoighill2@` gives `obaoighill` — but one read off a class list is
/// not, and `"Ó Baoighill"` starts with a character that is in no A-Z band. Without the
/// normalisation that student silently has no tutorial and nothing says why. The same
/// applies to Ó, Ní, Ü, Ś and every other diacritic in the cohort.
///
/// A surname in a non-Latin script still returns null, which is the honest answer: an
/// alphabetical split does not describe it, and guessing a band would be worse than saying
/// so. The caller surfaces it for a human.
export function bandFor(surname: string, rule: SplitRule): SplitRange | null {
  const first = surname
    .trim()
    .normalize("NFD")                 // "Ó" becomes "O" + combining acute
    .replace(/[\u0300-\u036f]/g, "") // drop the combining marks
    .toUpperCase()[0];
  if (!first || !LETTERS.includes(first)) return null;
  return rule.ranges.find((r) => first >= r.from && first <= r.to) ?? null;
}

/// Every hour, room and day in a split must be traceable to something the administrator
/// actually wrote.
///
/// The system prompt already says "if no end time is given, ask — do not assume an hour".
/// On 23 Sep 2026, given "A-M on Tuesday at 10, N-Z on Thursday at 2", Mistral Small
/// proposed 10:00–11:00 and 14:00–15:00 anyway, and every other check passed it. An
/// instruction the model can ignore is not a safeguard, so this is the safeguard: a value
/// that appears nowhere in the conversation was invented, and an invented end time reaches
/// a student's phone looking exactly like a real one.
///
/// Hours are matched as whole numbers in either clock — 14:00 is satisfied by "14" or "2" —
/// and never inside a longer number, so the 1 in "EEG1001" is not an 11. The cost is a
/// false alarm when someone confirms with "yes" to a question the model asked, which the
/// source avoids by including the model's own turns: a time it asked about is on the record.
/// A saved split written out as words, to stand as the source of a copy of it. The
/// provenance check asks that every day, hour and room was said somewhere; for a copy they
/// were said by the saved split. Hours lose their leading zero because the check looks for
/// "9", and in "09" the 9 has a digit in front of it.
export function splitSource(module: string, activity: string, ranges: SplitRange[]): string {
  const hour = (t: string) => t.replace(/^0/, "");
  return `Reused the ${module} ${activity} split: ` + ranges
    .map((r) => `${r.from}–${r.to} ${r.day} ${hour(r.start)}–${hour(r.end)}${r.room ? ` ${r.room}` : ""}`)
    .join("; ");
}

export function checkProvenance(rule: SplitRule, source: string): RuleProblem[] {
  const text = source.toLowerCase();
  const problems: RuleProblem[] = [];
  const mentions = (n: number) => new RegExp(`(?<!\\d)${n}(?!\\d)`).test(text);
  const hourSaid = (hhmm: string) => {
    const h = Number(hhmm.split(":")[0]);
    return Number.isFinite(h) && (mentions(h) || mentions(h % 12 === 0 ? 12 : h % 12));
  };

  for (const r of rule.ranges) {
    const band = `${r.from}-${r.to}`;
    const unsaid: string[] = [];
    if (r.start && !hourSaid(r.start)) unsaid.push(`start ${r.start}`);
    if (r.end && !hourSaid(r.end)) unsaid.push(`end ${r.end}`);
    if (r.day && !text.includes(r.day.toLowerCase().slice(0, 3))) unsaid.push(`day ${r.day}`);
    if (r.room && !text.replace(/\s+/g, "").includes(r.room.toLowerCase().replace(/\s+/g, ""))) {
      unsaid.push(`room ${r.room}`);
    }
    if (unsaid.length) {
      problems.push({
        level: "error",
        message:
          `${band}: ${unsaid.join(", ")} ${unsaid.length > 1 ? "appear" : "appears"} nowhere in ` +
          `what you wrote, so it was assumed. Say it explicitly if it is right.`,
      });
    }
  }
  return problems;
}
