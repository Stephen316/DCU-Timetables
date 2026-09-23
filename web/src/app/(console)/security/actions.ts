"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { currentProfile, supabaseServer } from "@/lib/supabase/server";
import { UNLOCK_COOKIE, newUnlockToken } from "@/lib/auth/pin";

/// Every action here re-checks admin. A Server Action is its own entry point, reachable by
/// POST without ever rendering the page that hosts it, so the lock screen being on screen
/// is not evidence of anything.
async function requireAdmin() {
  const profile = await currentProfile();
  if (!profile || profile.role !== "admin") throw new Error("Not allowed.");
  return profile;
}

export async function unlock(_prev: unknown, form: FormData) {
  await requireAdmin();
  const pin = String(form.get("pin") ?? "").trim();
  if (!/^[0-9]{4}$/.test(pin)) return { error: "Four digits." };

  const token = newUnlockToken();
  const db = await supabaseServer();
  const { data, error } = await db.rpc("unlock_with_pin", { p_pin: pin, p_token: token });
  if (error) return { error: error.message };
  if (data !== true) {
    // Deliberately one message for a wrong PIN and for a locked account. Telling them
    // apart is only useful to someone working through the 10 000.
    return { error: "That PIN did not work." };
  }

  (await cookies()).set(UNLOCK_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function lockNow() {
  await requireAdmin();
  const store = await cookies();
  const token = store.get(UNLOCK_COOKIE)?.value;
  if (token) {
    const db = await supabaseServer();
    // Dropped server-side too. Deleting only the cookie would leave a token that still
    // works if anyone kept a copy of it.
    await db.rpc("clear_unlock", { p_token: token });
  }
  store.delete(UNLOCK_COOKIE);
  revalidatePath("/", "layout");
}

export async function setPin(_prev: unknown, form: FormData) {
  await requireAdmin();
  const pin = String(form.get("pin") ?? "").trim();
  const again = String(form.get("again") ?? "").trim();
  if (!/^[0-9]{4}$/.test(pin)) return { error: "A PIN is exactly four digits." };
  if (pin !== again) return { error: "The two PINs do not match." };

  const db = await supabaseServer();
  const { error } = await db.rpc("set_admin_pin", { p_pin: pin });
  if (error) return { error: error.message };

  // Setting a PIN drops every unlock, including this browser's, so the next page view
  // proves the new PIN works rather than assuming it.
  (await cookies()).delete(UNLOCK_COOKIE);
  revalidatePath("/", "layout");
  return { ok: true };
}
