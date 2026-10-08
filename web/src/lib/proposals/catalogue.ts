import "server-only";
import { stripModuleCode } from "@/lib/abbreviations/names";
import { programmeCatalogue, programmeModules, type DcuProgramme } from "@/lib/dcu/timetable";
import { PROGRAMMES, checkScope, programmeFor, type Programme, type Scope } from "./courses";
import type { RuleProblem } from "./rules";

// Every course Ask can be pointed at: the fixed ones in courses.ts, then every other
// programme on DCU's timetable, each as its own course under its code — "CASE3".
//
// The fixed ones keep their hand-checked module lists and their programme groups. A DCU
// course's modules are read from its timetable, so they are whatever DCU publishes. The
// programmes a fixed course covers are left out of the rest: ECE1 is General Engineering's,
// and a change saved under "ECE1" would reach no phone, which files ECE1 under EEG1.

export type CourseOption = { key: string; name: string; hint: string; keywords: string };

/// "AC3 (Chem & Pharma Science-AT-3)" → "Chem & Pharma Science-AT-3".
function described(name: string): string {
  return name.trim().replace(/^\S+\s*/, "").replace(/^\((.*)\)$/, "$1").trim() || name.trim();
}

function nameOf(p: DcuProgramme): string {
  const names = [...new Set(p.names.map(described))];
  return names.length === 1 ? names[0] : `${names[0]} + ${names.length - 1} more`;
}

const covered = () => new Set(PROGRAMMES.flatMap((p) => p.covers.map((c) => c.code)));

/// For the picker. The fixed courses first, then DCU's, by code.
export async function courseOptions(): Promise<CourseOption[]> {
  const fixed = PROGRAMMES.map((p) => ({
    key: p.key, name: p.name,
    hint: `${p.modules.length} modules · ${p.covers.map((c) => c.code).join(", ")}`,
    keywords: p.covers.map((c) => `${c.code} ${c.name} ${c.cao}`).join(" "),
  }));
  const skip = covered();
  const dcu = (await programmeCatalogue())
    .filter((p) => !skip.has(p.code) && !programmeFor(p.code))
    .map((p) => ({
      key: p.code, name: nameOf(p),
      hint: p.names.length > 1 ? `${p.names.length} programmes under ${p.code}` : "DCU timetable",
      keywords: p.names.join(" "),
    }));
  return [...fixed, ...dcu];
}

/// A course with its modules: a fixed one as written, a DCU one read from its timetable.
/// Undefined when DCU has no such programme. Throws when DCU can't be reached, so that
/// "couldn't check" is never reported as "doesn't exist".
export async function resolveCourse(key: string): Promise<Programme | undefined> {
  const fixed = programmeFor(key);
  if (fixed) return fixed;
  const code = key.trim().toUpperCase();
  if (!code || covered().has(code)) return undefined;
  const entry = (await programmeCatalogue()).find((p) => p.code === code);
  if (!entry) return undefined;
  const modules = await programmeModules(code);
  return {
    key: code,
    name: nameOf(entry),
    covers: [],
    modules: modules.map((m) => ({ code: m.code, title: cleanTitle(m.name, m.code) })),
  };
}

/// DCU's module names carry their codes and often a semester: "EEG1001[1] Project & Technical
/// Drawing (Semester 1 & 2)". The title is what is left; the code alone when that is all.
function cleanTitle(name: string, code: string): string {
  return stripModuleCode(name, code).replace(/\s*\(Semester[^)]*\)\s*$/i, "").trim() || code;
}

/// checkScope against the course as the server knows it, DCU's included.
export async function scopeCheck(
  scope: Scope,
  proposed: { module?: string | null; programme?: string | null } = {},
): Promise<RuleProblem[]> {
  if (!scope.programme || programmeFor(scope.programme)) return checkScope(scope, proposed);
  try {
    return checkScope(scope, proposed, await resolveCourse(scope.programme));
  } catch {
    return [{ level: "error", message: `DCU's timetable couldn't be reached to check ${scope.programme}. Try again.` }];
  }
}

/// Class lists and lab rotations reach phones only for the courses the app has a cohort for
/// — General Engineering, Year 1. Anywhere else one would save and reach no one.
export function phoneCohortProblem(scope: Scope, what: "class list" | "lab rotation"): RuleProblem[] {
  return programmeFor(scope.programme)
    ? []
    : [{ level: "error", message: `A ${what} reaches phones only for ${PROGRAMMES.map((p) => p.name).join(", ")}. ${scope.programme || "This course"} can have splits, timetable changes and headings.` }];
}
