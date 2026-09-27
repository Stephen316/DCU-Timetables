"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { consoleOpen } from "@/lib/auth/gate";
import { supabaseServer } from "@/lib/supabase/server";

/// Every mutation goes through a Postgres RPC rather than a table write, so the action and
/// its audit row land in one transaction. A console that writes the row and then logs it
/// will eventually do the first and not the second — in exactly the case you needed the
/// log for.
///
/// Each function below also checks the console is open in this browser: the database
/// functions check the caller is an admin, but only the console knows about its lock.

const LOCKED = "The console is locked, or this account isn't an admin.";

export async function verifyDeadline(id: string, status: "verified" | "rejected" | "pending") {
  if (!(await consoleOpen())) return { error: LOCKED };
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("verify_deadline", { deadline: id, new_status: status });
  if (error) return { error: error.message };
  revalidatePath("/review");
  revalidatePath("/deadlines");
  return {};
}

/// Confirm, block, unblock or remove one deadline. Confirming or blocking also closes its
/// open reports, since either is the decision they were waiting on; removing deletes it,
/// with its confirmations and reports, and keeps a copy in the audit log.
export async function moderateDeadline(id: string, action: "confirm" | "block" | "unblock" | "remove") {
  if (!(await consoleOpen())) return { error: LOCKED };
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("moderate_deadline", { p_deadline: id, p_action: action });
  if (error) return { error: error.message };
  revalidatePath("/review");
  revalidatePath("/deadlines");
  return {};
}

/// The same edit a poster makes from the app, without their limits: a blocked or past
/// deadline can be corrected too. Moving the date or type clears the confirmations.
export async function editDeadline(id: string, title: string, kind: string, due: string) {
  if (!(await consoleOpen())) return { error: LOCKED };
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("edit_deadline", { p_deadline: id, p_title: title, p_kind: kind, p_due: due });
  if (error) return { error: error.message };
  revalidatePath("/review");
  revalidatePath("/deadlines");
  return {};
}

/// Closes every open report on a deadline. "remove" also rejects the deadline, which takes
/// it out of every student's view.
export async function resolveReports(id: string, action: "dismiss" | "remove") {
  if (!(await consoleOpen())) return { error: LOCKED };
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("resolve_deadline_reports", { p_deadline: id, p_action: action });
  if (error) return { error: error.message };
  revalidatePath("/review");
  revalidatePath("/deadlines");
  return {};
}

export async function setRole(id: string, role: "student" | "trusted" | "admin") {
  if (!(await consoleOpen())) return { error: LOCKED };
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("set_user_role", { target: id, new_role: role });
  if (error) return { error: error.message };
  revalidatePath("/people");
  return {};
}

export async function setBan(id: string, days: number | null, reason: string) {
  if (!(await consoleOpen())) return { error: LOCKED };
  const supabase = await supabaseServer();
  const until =
    days === null ? null : new Date(Date.now() + days * 86_400_000).toISOString();
  const { error } = await supabase.rpc("set_user_ban", { target: id, until, reason });
  if (error) return { error: error.message };
  revalidatePath("/people");
  return {};
}

export async function findByPI(pi: string) {
  if (!(await consoleOpen())) return { error: LOCKED };
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("find_by_pi", { identifier: pi });
  if (error) return { error: error.message };
  const match = Array.isArray(data) ? data[0] : data;
  if (!match) return { error: "No account with that ID." };
  return { profile: match };
}

/// Closes the console in this browser. It stays signed in, so the code opens it again.
export async function lock() {
  const supabase = await supabaseServer();
  await supabase.rpc("lock_console_session");
  redirect("/unlock");
}

/// Ends this browser's session. It needs the email sign-in before the code works here again.
export async function signOut() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/unlock");
}
