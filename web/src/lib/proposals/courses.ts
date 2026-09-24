// The programme → module taxonomy, and the scope check that keeps a proposal inside it.
//
// No `server-only`: pure data and pure functions, so the same check runs when a proposal is
// made and again when it is saved.
//
// Sourced from DCU's public timetable API (the one the app reads) on 23 Sep 2026, not from
// this repository. Six DCU programmes share a common first year, "(Engineering-1)", and the
// modules here are exactly the EEG modules DCU lists against all six of them. The first
// version of this list was assembled by grepping the repo for codes: it missed EEG1005 and
// EEG1008, and picked up EEG1003 only because a comment used it as an example.
//
// The six are one course here — Ask offers only this, General Engineering — and each is
// also a group of it on the Timetable page: some classes split by programme, which DCU's
// timetable doesn't show — it lists the same 226 classes against all six (24 Sep 2026). A
// change for BMED1 reaches only Biomedical students. The database's copy of `covers` is
// course_programmes (supabase/phase19_programme_groups.sql).

import type { RuleProblem } from "./rules";

export type Module = {
  code: string;
  /// DCU's title, without the "(Semester …)" suffix it carries in the API.
  title: string;
  semester: "1" | "2" | "1 & 2";
  /// Search-only words, for where people's words and DCU's differ. "maths" is not a
  /// substring of "Mathematics", and "2" is not in "II" — typing either found nothing.
  aka?: string;
};

export type Programme = {
  key: string;
  name: string;
  /// The DCU programme codes this entry stands for. Searchable, so an administrator who
  /// thinks of it as "ECE1" or "Mechatronic" still finds it. Each is also a group a change
  /// can be for.
  covers: readonly { code: string; name: string; cao: string }[];
  modules: readonly Module[];
};

export const PROGRAMMES: readonly Programme[] = [
  {
    key: "EEG1",
    name: "General Engineering — Year 1",
    covers: [
      // Names and CAO codes from dcu.ie's course pages.
      { code: "BMED1", name: "Biomedical Engineering", cao: "DC197" },
      { code: "CAM1", name: "Mechanical and Manufacturing Engineering", cao: "DC195" },
      { code: "CE1", name: "Common Entry into Engineering", cao: "DC200" },
      { code: "ECE1", name: "Electronic and Computer Engineering", cao: "DC190" },
      { code: "ME1", name: "Mechatronic Engineering", cao: "DC193" },
      { code: "SSE1", name: "Mechanical and Sustainability Engineering", cao: "DC194" },
    ],
    modules: [
      { code: "EEG1000", title: "Fundamentals of Professional Development", semester: "1 & 2" },
      { code: "EEG1001", title: "Project & Technical Drawing", semester: "1 & 2" },
      { code: "EEG1002", title: "Programming & Software Development for Engineers", semester: "1 & 2" },
      { code: "EEG1003", title: "Engineering Mechanics-Statics", semester: "2" },
      { code: "EEG1004", title: "Introduction to Electronics", semester: "1 & 2" },
      { code: "EEG1005", title: "Numerical Problem Solving for Engineers", semester: "2" },
      { code: "EEG1006", title: "Materials Engineering", semester: "1" },
      { code: "EEG1007", title: "Engineering Mathematics I", semester: "1", aka: "maths 1" },
      { code: "EEG1008", title: "Engineering Mathematics II", semester: "2", aka: "maths 2" },
      { code: "EEG1017", title: "Basic Sciences for Engineers (Physical, Chemical, Life)", semester: "1" },
    ],
  },
];

export function programmeFor(key: string): Programme | undefined {
  return PROGRAMMES.find((p) => p.key === key);
}

export function modulesFor(key: string): readonly Module[] {
  return programmeFor(key)?.modules ?? [];
}

export function moduleFor(code: string): Module | undefined {
  return PROGRAMMES.flatMap((p) => p.modules).find((m) => m.code === code);
}

/// The shape of a programme code, BMED1, as against a lab group's C or C.2.
export const PROGRAMME_CODE = /^[A-Z]{2,5}[0-9]$/;

/// What the administrator picked in the two dropdowns.
export type Scope = { programme: string; module: string };

/// Codes are compared case- and space-insensitively. "eeg1001 " and "EEG1001" are the same
/// module, and treating them as different would block a save for no reason a person can see.
const norm = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();

/// Checked when a proposal is made AND again when it is saved.
///
/// The second call is the one that matters: between seeing a proposal and accepting it, the
/// payload and the picture on screen are two different objects, and the dropdowns can move
/// underneath a proposal that is already on the panel.
///
/// A disagreement between the selection and what the model read is an `error`, not a
/// warning, so it blocks saving. The two readings of "EEG1001 vs EEG1002" are a mis-click
/// and a misread, and there is no way to tell which from here — but both are resolved the
/// same way, by a person looking at it.
export function checkScope(
  scope: Scope,
  proposed: { module?: string | null; programme?: string | null } = {},
): RuleProblem[] {
  const problems: RuleProblem[] = [];

  const programme = programmeFor(scope.programme);
  if (!programme) {
    return [{ level: "error", message: "No programme selected." }];
  }
  if (!scope.module) {
    return [{ level: "error", message: "No module selected." }];
  }
  if (!programme.modules.some((m) => norm(m.code) === norm(scope.module))) {
    problems.push({
      level: "error",
      message: `${scope.module} is not a module of ${programme.name}.`,
    });
  }

  if (proposed.module && norm(proposed.module) !== norm(scope.module)) {
    problems.push({
      level: "error",
      message:
        `You selected ${scope.module}, but the request describes ${proposed.module}. ` +
        `Change the selection or reword it — nothing is saved while these disagree.`,
    });
  }

  if (proposed.programme && norm(proposed.programme) !== norm(scope.programme)) {
    problems.push({
      level: "error",
      message:
        `You selected programme ${scope.programme}, but the document describes ` +
        `${proposed.programme}. Change the selection or re-read the document.`,
    });
  }

  return problems;
}
