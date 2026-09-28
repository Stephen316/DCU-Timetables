// What an abbreviation on the app's week grid may be. Pure, so the page checks as the admin
// types, and the server checks again before saving.

import { MODULE_KEY, STARTS_WITH_CODE } from "./names";

/// A module's row in `module_abbreviations`, as the page edits it. With no abbreviation the
/// app shortens DCU's name itself. A flag is for the console alone: why a person should look,
/// and the assistant's best guess when it had one.
export type Entry = {
  abbreviation: string | null;
  /// "ai" for an abbreviation saved from the assistant's suggestions, "manual" for one a
  /// person typed or picked. The assistant never replaces a manual one.
  source: "manual" | "ai" | null;
  flag: string | null;
  suggestion: string | null;
};

export const NO_ENTRY: Entry = { abbreviation: null, source: null, flag: null, suggestion: null };

/// As it is saved: one line, trimmed, and no source without an abbreviation.
export function normalEntry(e: Entry): Entry {
  const abbreviation = e.abbreviation?.replace(/\s+/g, " ").trim() || null;
  return {
    abbreviation,
    source: abbreviation ? e.source : null,
    flag: e.flag?.trim() || null,
    suggestion: e.suggestion?.trim() || null,
  };
}

export function sameEntry(a: Entry, b: Entry): boolean {
  return a.abbreviation === b.abbreviation && a.source === b.source && a.flag === b.flag && a.suggestion === b.suggestion;
}

/// Checked before a save, on the page and again on the server. The database's constraints
/// hold the same rules, and this says why in words instead of a constraint's name.
export function entryProblem(code: string, e: Entry): string | null {
  if (!MODULE_KEY.test(code)) return `${code} isn't a module code.`;
  if (e.abbreviation !== null) {
    const problem = abbreviationProblem(e.abbreviation);
    if (problem) return problem;
    if (e.source !== "manual" && e.source !== "ai") return "An abbreviation needs to say who set it.";
  } else if (e.source !== null) {
    return "There's no abbreviation for that to be the source of.";
  }
  if (e.flag !== null && !(e.flag.trim() && e.flag.length <= 300)) return "The flag's reason is empty or too long.";
  if (e.suggestion !== null && !(e.suggestion.trim() && e.suggestion.length <= 80)) return "The suggestion is empty or too long.";
  return null;
}

/// A week-grid block on a phone is about 68pt wide, which fits about 10 characters of its
/// bold caption per line. A one-hour class has two lines for the title under its room, so
/// 20 characters is the most that shows without clipping, and 12 fits on one line.
export const ABBREVIATION_LIMIT = 20;
export const ABBREVIATION_AIM = 12;

/// supabase/phase28_module_abbreviations.sql holds the same limit.
export function abbreviationProblem(text: string): string | null {
  const t = text.trim();
  if (!t) return "It's empty.";
  if (t.length > ABBREVIATION_LIMIT) {
    return `It's ${t.length} characters; a week-grid block fits ${ABBREVIATION_LIMIT}.`;
  }
  if (STARTS_WITH_CODE.test(t)) return "It starts with a module code. The week grid shows names, not codes.";
  return null;
}

export type Named = { code: string; name: string; abbreviation: string | null };

/// Modules with different names but the same abbreviation, since two blocks reading the
/// same would look like the same module. Maps each module's code to the other module's.
/// Modules DCU gives the same name, like its three "Engineering Mathematics IV", are left
/// alone: sharing an abbreviation there is right.
export function clashes(modules: Named[]): Map<string, Named> {
  const byText = new Map<string, Named[]>();
  for (const m of modules) {
    if (!m.abbreviation?.trim()) continue;
    const key = squash(m.abbreviation);
    byText.set(key, [...(byText.get(key) ?? []), m]);
  }
  const out = new Map<string, Named>();
  for (const group of byText.values()) {
    for (const m of group) {
      const other = group.find((o) => squash(o.name) !== squash(m.name));
      if (other) out.set(m.code, other);
    }
  }
  return out;
}

function squash(text: string): string {
  return text.toLowerCase().replace(/[\s.]+/g, " ").trim();
}
