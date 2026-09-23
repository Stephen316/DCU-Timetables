// The programme → module taxonomy, and the scope check that keeps a proposal inside it.
//
// No `server-only`: pure data and pure functions, so the same check runs when a proposal is
// made and again when it is saved.
//
// ⚠️ This list is not authoritative. It was assembled from the module codes that appear in
// this repository, and the grouping into a programme is an assumption — nothing in the app
// or the database records which modules belong to which programme. Correct it here; this is
// the only place a module code is written down.

import type { RuleProblem } from "./rules";

export type Programme = {
  key: string;
  name: string;
  modules: readonly string[];
};

export const PROGRAMMES: readonly Programme[] = [
  {
    key: "EEG1",
    name: "Engineering — Year 1",
    modules: [
      "EEG1000", "EEG1001", "EEG1002", "EEG1003",
      "EEG1004", "EEG1006", "EEG1007", "EEG1017",
    ],
  },
];

export function programmeFor(key: string): Programme | undefined {
  return PROGRAMMES.find((p) => p.key === key);
}

export function modulesFor(key: string): readonly string[] {
  return programmeFor(key)?.modules ?? [];
}

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
  if (!programme.modules.some((m) => norm(m) === norm(scope.module))) {
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
