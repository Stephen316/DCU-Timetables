"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { consoleOpen } from "@/lib/auth/gate";
import { supabaseServer } from "@/lib/supabase/server";

/// Every action here re-checks admin, and that this browser is open. A Server Action is its
/// own entry point, reachable by POST without ever rendering the page that hosts it — and
/// changing the code from a locked browser would undo the lock.
async function requireOpen() {
  if (!(await consoleOpen())) throw new Error("The console is locked, or this account isn't an admin.");
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

export type TwoStepSetup = { error?: string; setup?: { factorId: string; qr: string; secret: string } } | null;
export type TwoStepDone = { error?: string; ok?: boolean } | null;

/// Begins setting up an authenticator app: a TOTP factor the app has not yet proved it
/// holds. The QR code and secret are shown once, here, and not stored by the console.
export async function startTwoStep(): Promise<TwoStepSetup> {
  await requireOpen();
  const db = await supabaseServer();
  const { data: factors, error: listError } = await db.auth.mfa.listFactors();
  if (listError) return { error: `Couldn't check two-step sign-in (${listError.message}).` };
  if (factors.totp.length > 0) return { error: "Two-step sign-in is already on for this account." };

  // An abandoned set-up leaves an unverified factor behind, and enrolling again would clash
  // with it.
  for (const factor of factors.all.filter((f) => f.factor_type === "totp" && f.status === "unverified")) {
    await db.auth.mfa.unenroll({ factorId: factor.id });
  }

  const { data, error } = await db.auth.mfa.enroll({ factorType: "totp", friendlyName: "Console" });
  if (error || !data) return { error: `Couldn't start the set-up (${error?.message ?? "try again"}).` };
  return { setup: { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret } };
}

/// Finishes it: the code the authenticator app now shows proves it holds the secret, and
/// only then is the factor switched on.
export async function confirmTwoStep(_prev: TwoStepDone, form: FormData): Promise<TwoStepDone> {
  await requireOpen();
  const factorId = String(form.get("factorId") ?? "");
  const code = String(form.get("code") ?? "").replace(/\s/g, "");
  if (!factorId) return { error: "Start the set-up again." };
  if (!/^[0-9]{6}$/.test(code)) return { error: "Enter the six digits the app shows." };

  const db = await supabaseServer();
  const { error } = await db.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return { error: "That code didn't work. Check the time on your phone and use the newest code." };
  revalidatePath("/security");
  return { ok: true };
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
