"use server";

import { redirect } from "next/navigation";
import { consoleStatus } from "@/lib/auth/gate";
import { currentProfile, supabaseServer } from "@/lib/supabase/server";

/// Every action here re-checks admin, and that this browser is open. A Server Action is its
/// own entry point, reachable by POST without ever rendering the page that hosts it — and
/// changing the code from a locked browser would undo the lock.
async function requireOpen() {
  const profile = await currentProfile();
  if (!profile || profile.role !== "admin") throw new Error("Not allowed.");
  if (!(await consoleStatus())?.unlocked) throw new Error("The console is locked.");
}

export async function changeCode(_prev: unknown, form: FormData) {
  await requireOpen();
  const code = String(form.get("code") ?? "").trim();
  const again = String(form.get("again") ?? "").trim();
  if (!/^[0-9]{4}$/.test(code)) return { error: "The code is exactly four digits." };
  if (code !== again) return { error: "The two codes do not match." };

  const db = await supabaseServer();
  const { error } = await db.rpc("change_console_code", { p_code: code });
  return error ? { error: error.message } : { ok: true };
}

/// Signs out every browser that has opened the console, this one included — each needs the
/// email sign-in again. For when a device that had it open is lost, or the code may have
/// been seen. The app stays signed in.
export async function signOutEverywhere() {
  await requireOpen();
  const db = await supabaseServer();
  const { error } = await db.rpc("end_console_sessions");
  if (error) throw new Error(`Couldn't sign the browsers out: ${error.message}`);
  // This browser's session has just been ended too; this clears its cookies.
  await db.auth.signOut({ scope: "local" });
  redirect("/unlock");
}
