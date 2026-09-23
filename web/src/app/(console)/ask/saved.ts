"use server";

import { currentProfile, supabaseServer } from "@/lib/supabase/server";
import { modulesFor } from "@/lib/proposals/courses";

/// What is live in the database for one programme and module — the "Saved" list under the
/// chat. Read-only, and read as the signed-in admin, so RLS applies as everywhere else.
///
/// A class list comes back as counts per group and subgroup, never as names: the names are
/// reduced to keys when saved, and nothing here could show them if it tried.

export type SavedSession = {
  week: number | null; date: string | null; day: string | null;
  start: string | null; end: string | null;
  module: string | null; activity: string | null; groups: string[]; room: string | null;
};

export type ClassGroup = {
  group: string; subgroup: string | null; count: number;
  day: string | null; workshop: string | null; drawing: string | null;
};

export type SavedView = {
  rotation: {
    title: string | null; version: number; savedAt: string;
    total: number;              // every session in the rotation
    sessions: SavedSession[];   // those for the selected module, or all of them
  } | null;
  splits: {
    module: string; activity: string; note: string | null; savedAt: string;
    ranges: { from: string; to: string; day: string; start: string; end: string; room: string | null; label: string | null }[];
  }[];
  classList: {
    title: string | null; version: number; members: number; savedAt: string;
    groups: ClassGroup[];
  } | null;
};

export async function listSaved(programme: string, module: string):
  Promise<{ ok: true; view: SavedView } | { ok: false; error: string }> {
  const profile = await currentProfile();
  if (!profile || profile.role !== "admin") return { ok: false, error: "Not allowed." };
  if (!programme) return { ok: true, view: { rotation: null, splits: [], classList: null } };

  const db = await supabaseServer();
  // With no module chosen, the splits of every module in the programme.
  const modules = module ? [module] : modulesFor(programme).map((m) => m.code);

  const [rot, splits, roster] = await Promise.all([
    db.from("lab_rotations")
      .select("title, version, created_at, lab_rotation_sessions(week, date, day, start_time, end_time, module, activity, groups, room)")
      .eq("course_key", programme).maybeSingle(),
    modules.length
      ? db.from("module_splits")
          .select("module_key, activity, note, created_at, module_split_ranges(from_letter, to_letter, day, start_time, end_time, room, label)")
          .in("module_key", modules).order("module_key").order("activity")
      : Promise.resolve({ data: [], error: null }),
    db.from("rosters").select("title, version, members, created_at").eq("course_key", programme).maybeSingle(),
  ]);
  const failed = rot.error ?? splits.error ?? roster.error;
  if (failed) return { ok: false, error: failed.message };

  let rotation: SavedView["rotation"] = null;
  if (rot.data) {
    const all: SavedSession[] = (rot.data.lab_rotation_sessions ?? []).map((s: Record<string, unknown>) => ({
      week: s.week as number | null, date: s.date as string | null, day: s.day as string | null,
      start: s.start_time as string | null, end: s.end_time as string | null,
      module: s.module as string | null, activity: s.activity as string | null,
      groups: (s.groups as string[] | null) ?? [], room: s.room as string | null,
    }));
    all.sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));
    rotation = {
      title: rot.data.title, version: rot.data.version, savedAt: rot.data.created_at,
      total: all.length,
      sessions: module ? all.filter((s) => s.module === module) : all,
    };
  }

  let classList: SavedView["classList"] = null;
  if (roster.data) {
    const { data: rows, error } = await db.from("course_allocations")
      .select("grp, subgroup, day, workshop, drawing").eq("course_key", programme);
    if (error) return { ok: false, error: error.message };
    const counts = new Map<string, ClassGroup>();
    for (const r of rows ?? []) {
      const k = [r.grp, r.subgroup, r.day, r.workshop, r.drawing].join("\u0000");
      const g = counts.get(k);
      if (g) g.count++;
      else counts.set(k, { group: r.grp, subgroup: r.subgroup, count: 1, day: r.day, workshop: r.workshop, drawing: r.drawing });
    }
    classList = {
      title: roster.data.title, version: roster.data.version, members: roster.data.members,
      savedAt: roster.data.created_at,
      groups: [...counts.values()].sort((a, b) =>
        `${a.group}${a.subgroup ?? ""}${a.drawing ?? ""}`.localeCompare(`${b.group}${b.subgroup ?? ""}${b.drawing ?? ""}`)),
    };
  }

  return {
    ok: true,
    view: {
      rotation,
      splits: (splits.data ?? []).map((s: Record<string, any>) => ({
        module: s.module_key, activity: s.activity, note: s.note, savedAt: s.created_at,
        ranges: ((s.module_split_ranges ?? []) as Record<string, any>[])
          .map((r) => ({ from: r.from_letter, to: r.to_letter, day: r.day, start: r.start_time, end: r.end_time, room: r.room, label: r.label }))
          .sort((a, b) => a.from.localeCompare(b.from)),
      })),
      classList,
    },
  };
}
