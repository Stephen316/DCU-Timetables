"use server";

import { currentProfile, supabaseServer } from "@/lib/supabase/server";
import { PROGRAMMES, checkScope, moduleFor, type Scope } from "@/lib/proposals/courses";
import { checkProvenance, checkRule, splitSource, type SplitRule } from "@/lib/proposals/rules";
import { validateRotation, type RotationSession } from "@/lib/extraction/rotation";
import type { Proposal } from "@/lib/proposals/types";

/// Every table saved anywhere, so one read for one module can be used for another without
/// uploading it again. The Saved list shows what is live for the selection; this shows
/// everything, with what each one covers.
///
/// Only the current version of each exists: saving replaces, and nothing older is kept.

export type LibraryEntry =
  | {
      kind: "rotation"; programme: string; title: string | null; version: number; savedAt: string;
      total: number;
      /// Per module, in the order DCU lists them: how many sessions, under which headings.
      modules: { code: string; sessions: number; activities: string[] }[];
    }
  | {
      kind: "split"; module: string; activity: string; note: string | null; savedAt: string;
      /// The programmes the module belongs to — a module can sit in more than one.
      programmes: string[];
      ranges: { from: string; to: string; day: string; start: string; end: string; room: string | null }[];
    }
  | { kind: "classList"; programme: string; title: string | null; version: number; members: number; groups: number; savedAt: string };

type Failed = { ok: false; error: string };

async function admin() {
  const profile = await currentProfile();
  return profile?.role === "admin";
}

export async function listLibrary(): Promise<{ ok: true; entries: LibraryEntry[] } | Failed> {
  if (!(await admin())) return { ok: false, error: "Not allowed." };
  const db = await supabaseServer();

  const [rot, splits, rosters, groups] = await Promise.all([
    db.from("lab_rotations").select("course_key, title, version, created_at, lab_rotation_sessions(module, activity)"),
    db.from("module_splits")
      .select("module_key, activity, note, created_at, module_split_ranges(from_letter, to_letter, day, start_time, end_time, room)")
      .order("module_key").order("activity"),
    db.from("rosters").select("course_key, title, version, members, created_at"),
    db.from("course_allocations").select("course_key, grp"),
  ]);
  const failed = rot.error ?? splits.error ?? rosters.error ?? groups.error;
  if (failed) return { ok: false, error: failed.message };

  const order = (code: string) => {
    const i = PROGRAMMES.flatMap((p) => p.modules).findIndex((m) => m.code === code);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };

  const entries: LibraryEntry[] = [];

  for (const r of rot.data ?? []) {
    const sessions = (r.lab_rotation_sessions ?? []) as { module: string | null; activity: string | null }[];
    const byModule = new Map<string, { sessions: number; activities: Set<string> }>();
    for (const s of sessions) {
      const m = byModule.get(s.module ?? "?") ?? { sessions: 0, activities: new Set<string>() };
      m.sessions++;
      if (s.activity) m.activities.add(s.activity);
      byModule.set(s.module ?? "?", m);
    }
    entries.push({
      kind: "rotation", programme: r.course_key, title: r.title, version: r.version, savedAt: r.created_at,
      total: sessions.length,
      modules: [...byModule.entries()]
        .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
        .map(([code, m]) => ({ code, sessions: m.sessions, activities: [...m.activities].sort() })),
    });
  }

  for (const s of (splits.data ?? []) as Record<string, any>[]) {
    entries.push({
      kind: "split", module: s.module_key, activity: s.activity, note: s.note, savedAt: s.created_at,
      programmes: PROGRAMMES.filter((p) => p.modules.some((m) => m.code === s.module_key)).map((p) => p.key),
      ranges: ((s.module_split_ranges ?? []) as Record<string, any>[])
        .map((x) => ({ from: x.from_letter, to: x.to_letter, day: x.day, start: x.start_time, end: x.end_time, room: x.room }))
        .sort((a, b) => a.from.localeCompare(b.from)),
    });
  }

  for (const r of rosters.data ?? []) {
    const own = (groups.data ?? []).filter((g) => g.course_key === r.course_key);
    entries.push({
      kind: "classList", programme: r.course_key, title: r.title, version: r.version, members: r.members,
      groups: new Set(own.map((g) => g.grp)).size, savedAt: r.created_at,
    });
  }

  return { ok: true, entries };
}

export type Reused = { ok: true; proposal: Proposal; reply: string } | Failed;

/// A saved rotation back on the panel as a proposal, for the selected programme. From there
/// it is corrected by message, like an upload, and accepting saves it as a new version.
export async function reuseRotation(from: string, scope: Scope): Promise<Reused> {
  if (!(await admin())) return { ok: false, error: "Not allowed." };
  const db = await supabaseServer();
  const { data, error } = await db.from("lab_rotations")
    .select("title, version, created_at, lab_rotation_sessions(week, date, day, start_time, end_time, module, activity, groups, room)")
    .eq("course_key", from).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: `${from} has no saved rotation any more.` };

  const sessions: RotationSession[] = ((data.lab_rotation_sessions ?? []) as Record<string, any>[])
    .map((s) => ({
      week: s.week, date: s.date, day: s.day,
      start: s.start_time, end: s.end_time,
      module: s.module, activity: s.activity, groups: s.groups ?? [],
      ...(s.room ? { room: s.room as string } : {}),
    }))
    .sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));

  const copied = from !== scope.programme;
  const log = [{
    level: "info" as const,
    message: `${copied ? `Copied from ${from}'s` : "Loaded from the saved"} rotation, v${data.version}.`,
  }];
  const modules = [...new Set(sessions.map((s) => s.module).filter(Boolean))].join(", ");
  return {
    ok: true,
    reply:
      `${copied ? `Copied ${from}'s` : "Loaded the saved"} lab rotation onto the panel: ${sessions.length} sessions ` +
      `across ${modules || "no modules"}. Correct it by message; accepting saves it for ` +
      `${scope.programme || "the selected programme"} as a new version.`,
    proposal: {
      kind: "rotation", scope, courseKey: scope.programme, title: data.title, sessions, log,
      findings: [...checkScope(scope), ...log, ...validateRotation(sessions)],
    },
  };
}

/// A saved split, proposed for the selected module. The same bands often apply to a sister
/// module — a lecture split by surname in Maths I is usually the same in Maths II.
export async function reuseSplit(from: { module: string; activity: string }, scope: Scope): Promise<Reused> {
  if (!(await admin())) return { ok: false, error: "Not allowed." };
  const db = await supabaseServer();
  const [{ data, error }, existing] = await Promise.all([
    db.from("module_splits")
      .select("module_split_ranges(from_letter, to_letter, day, start_time, end_time, room, label)")
      .eq("module_key", from.module).eq("activity", from.activity).maybeSingle(),
    db.from("module_splits").select("module_key")
      .eq("module_key", scope.module).eq("activity", from.activity).maybeSingle(),
  ]);
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: `The ${from.module} ${from.activity} split is no longer saved.` };

  const rule: SplitRule = {
    moduleKey: scope.module,
    activity: from.activity,
    ranges: ((data.module_split_ranges ?? []) as Record<string, any>[])
      .map((r) => ({
        from: r.from_letter, to: r.to_letter, day: r.day,
        start: r.start_time, end: r.end_time,
        room: r.room ?? null, label: r.label ?? null,
      }))
      .sort((a, b) => a.from.localeCompare(b.from)),
  };

  const source = splitSource(from.module, from.activity, rule.ranges);

  const same = from.module === scope.module;
  const title = moduleFor(scope.module)?.title;
  return {
    ok: true,
    reply: same
      ? `Loaded the saved ${from.module} ${from.activity} split onto the panel. ${source.replace(/^[^:]+: /, "")}.`
      : `Copied the ${from.module} ${from.activity} split to ${scope.module || "?"}${title ? ` (${title})` : ""}: ` +
        `${source.replace(/^[^:]+: /, "")}. Tell me what differs and I'll propose again.`,
    proposal: {
      kind: "split", scope, rule, source,
      problems: [
        ...checkScope(scope),
        ...checkRule(rule),
        ...checkProvenance(rule, source),
        ...(!same ? [{
          level: "warn" as const,
          message: `Copied from ${from.module}. Check that ${scope.module}'s ${from.activity.toLowerCase()} classes are split the same way.`,
        }] : []),
        ...(existing.data && !same ? [{
          level: "warn" as const,
          message: `${scope.module} already has a ${from.activity} split. Accepting replaces it.`,
        }] : []),
      ],
    },
  };
}
