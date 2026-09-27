"use server";

import { revalidatePath } from "next/cache";
import { consoleOpen } from "@/lib/auth/gate";
import { supabaseServer } from "@/lib/supabase/server";
import { classes, weeks } from "@/lib/dcu/timetable";
import { audience, toRow, type TimetableChange } from "@/lib/changes/change";
import { review } from "@/lib/changes/review";

type Result = { ok: true } | { ok: false; error: string };

// A Server Action is reachable by POST without the page that hosts it, so each checks.
const NOT_ALLOWED = "The console is locked, or this account isn't an admin.";

export async function saveChange(change: TimetableChange): Promise<Result> {
  return saveChanges([change]);
}

/// Several changes, all or none — "keep only for BMED1" is a removal for each of the other
/// programmes, and half of those saved is a timetable nobody meant.
export async function saveChanges(changes: TimetableChange[]): Promise<Result> {
  if (!(await consoleOpen())) return { ok: false, error: NOT_ALLOWED };
  if (!changes.length) return { ok: false, error: "Nothing to save." };
  for (const change of changes) {
    const blocker = (await review(change)).find((f) => f.level === "error");
    if (blocker) return { ok: false, error: changes.length > 1 ? `${audience(change.group)}: ${blocker.message}` : blocker.message };
  }

  const db = await supabaseServer();
  // One change goes through phase 17's function, so saving one works before phase 19 is run.
  const { error } = changes.length === 1
    ? await db.rpc("save_timetable_change", { p_change: toRow(changes[0]) })
    : await db.rpc("save_timetable_changes", { p_changes: changes.map(toRow) });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/timetable");
  return { ok: true };
}

export async function deleteChange(id: string): Promise<Result> {
  if (!(await consoleOpen())) return { ok: false, error: NOT_ALLOWED };
  const db = await supabaseServer();
  const { data, error } = await db.rpc("delete_timetable_change", { p_id: id });
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Already gone." };
  revalidatePath("/timetable");
  return { ok: true };
}

/// Every date a class runs across the year: same activity, same weekday, same start. What
/// "remove every week" means, read from DCU rather than assumed from a week pattern.
export async function slotDates(module: string, code: string, day: string, start: string):
  Promise<{ ok: true; dates: string[] } | { ok: false; error: string }> {
  if (!(await consoleOpen())) return { ok: false, error: NOT_ALLOWED };
  try {
    const all = await weeks();
    const found = await classes([module], all.map((w) => w.number));
    const dates = found.filter((c) => c.code === code && c.day === day && c.start === start).map((c) => c.date);
    return { ok: true, dates: [...new Set(dates)].sort() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't reach DCU's timetable." };
  }
}
