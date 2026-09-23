"use server";

import { redirect } from "next/navigation";
import { currentProfile, supabaseServer } from "@/lib/supabase/server";

/// Every action here re-checks admin. A Server Action is its own entry point, reachable by
/// POST without ever rendering the page that hosts it.
async function requireAdmin() {
  const profile = await currentProfile();
  if (!profile || profile.role !== "admin") throw new Error("Not allowed.");
}

export async function changeCode(_prev: unknown, form: FormData) {
  await requireAdmin();
  const code = String(form.get("code") ?? "").trim();
  const again = String(form.get("again") ?? "").trim();
  if (!/^[0-9]{4}$/.test(code)) return { error: "The code is exactly four digits." };
  if (code !== again) return { error: "The two codes do not match." };

  const db = await supabaseServer();
  const { error } = await db.rpc("change_console_code", { p_code: code });
  return error ? { error: error.message } : { ok: true };
}

/// Ends the console account's session in every browser, this one included. For when a
/// device that had the console open is lost, or the code may have been seen.
export async function lockEverywhere() {
  await requireAdmin();
  const db = await supabaseServer();
  await db.auth.signOut({ scope: "global" });
  redirect("/unlock");
}
