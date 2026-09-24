"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

/// Every mutation goes through a Postgres RPC rather than a table write, so the action and
/// its audit row land in one transaction. A console that writes the row and then logs it
/// will eventually do the first and not the second — in exactly the case you needed the
/// log for.

export async function verifyDeadline(id: string, status: "verified" | "rejected" | "pending") {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("verify_deadline", { deadline: id, new_status: status });
  if (error) return { error: error.message };
  revalidatePath("/review");
  return {};
}

/// Closes every open report on a deadline. "remove" also rejects the deadline, which takes
/// it out of every student's view.
export async function resolveReports(id: string, action: "dismiss" | "remove") {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("resolve_deadline_reports", { p_deadline: id, p_action: action });
  if (error) return { error: error.message };
  revalidatePath("/review");
  return {};
}

export async function setRole(id: string, role: "student" | "trusted" | "admin") {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("set_user_role", { target: id, new_role: role });
  if (error) return { error: error.message };
  revalidatePath("/people");
  return {};
}

export async function setBan(id: string, days: number | null, reason: string) {
  const supabase = await supabaseServer();
  const until =
    days === null ? null : new Date(Date.now() + days * 86_400_000).toISOString();
  const { error } = await supabase.rpc("set_user_ban", { target: id, until, reason });
  if (error) return { error: error.message };
  revalidatePath("/people");
  return {};
}

export async function findByPI(pi: string) {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("find_by_pi", { identifier: pi });
  if (error) return { error: error.message };
  const match = Array.isArray(data) ? data[0] : data;
  if (!match) return { error: "No account with that ID." };
  return { profile: match };
}

/// Ends this browser's session. The code is asked for again on the next visit.
export async function signOut() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/unlock");
}
