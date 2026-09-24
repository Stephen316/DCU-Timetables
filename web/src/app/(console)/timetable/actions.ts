"use server";

import { revalidatePath } from "next/cache";
import { currentProfile, supabaseServer } from "@/lib/supabase/server";
import { classes, weeks } from "@/lib/dcu/timetable";
import { checkChange, hitFindings, removalHits, toRow, type TimetableChange } from "@/lib/changes/change";
import type { Finding } from "@/lib/extraction/rotation";

type Result = { ok: true } | { ok: false; error: string };

async function admin() {
  // A Server Action is reachable by POST without the page that hosts it.
  const profile = await currentProfile();
  return profile?.role === "admin";
}

/// The teaching weeks the dates fall in, so a removal is checked against those weeks only.
async function weeksFor(dates: string[]): Promise<number[]> {
  const all = await weeks();
  const within = (d: string, first: string) => {
    const t = Date.parse(`${d}T12:00:00Z`) - Date.parse(`${first}T00:00:00Z`);
    return t >= 0 && t < 7 * 86_400_000;
  };
  return [...new Set(dates.flatMap((d) => all.filter((w) => within(d, w.firstDay)).map((w) => w.number)))];
}

/// Everything saving would refuse or warn about, including — for a removal — whether each
/// date has a class to remove. Used by Ask when it proposes, and again here when it saves.
export async function reviewChange(change: TimetableChange): Promise<Finding[]> {
  const findings = checkChange(change);
  if (change.kind !== "remove" || findings.some((f) => f.level === "error")) return findings;
  try {
    const found = await classes([change.module], await weeksFor(change.dates));
    return [...findings, ...hitFindings(change, removalHits(change, found))];
  } catch {
    return [...findings, { level: "warn", message: "Couldn't reach DCU's timetable to check the dates have that class." }];
  }
}

export async function saveChange(change: TimetableChange): Promise<Result> {
  if (!(await admin())) return { ok: false, error: "Not allowed." };
  const blocker = (await reviewChange(change)).find((f) => f.level === "error");
  if (blocker) return { ok: false, error: blocker.message };

  const db = await supabaseServer();
  const { error } = await db.rpc("save_timetable_change", { p_change: toRow(change) });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/timetable");
  return { ok: true };
}

export async function deleteChange(id: string): Promise<Result> {
  if (!(await admin())) return { ok: false, error: "Not allowed." };
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
  if (!(await admin())) return { ok: false, error: "Not allowed." };
  try {
    const all = await weeks();
    const found = await classes([module], all.map((w) => w.number));
    const dates = found.filter((c) => c.code === code && c.day === day && c.start === start).map((c) => c.date);
    return { ok: true, dates: [...new Set(dates)].sort() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't reach DCU's timetable." };
  }
}
