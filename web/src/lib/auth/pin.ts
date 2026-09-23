import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";

/// The unlock token lives in an httpOnly cookie, so page scripts cannot read it and an XSS
/// cannot lift it. Only its SHA-256 lands in the database — a dump of `admin_unlocks` is
/// a list of hashes, not a set of working unlocks.
export const UNLOCK_COOKIE = "console_unlock";

export type PinStatus = {
  hasPin: boolean;
  lockedUntil: string | null;
  attemptsLeft: number;
};

export async function pinStatus(): Promise<PinStatus> {
  const db = await supabaseServer();
  const { data } = await db.rpc("admin_pin_status").maybeSingle<{
    has_pin: boolean; locked_until: string | null; attempts_left: number;
  }>();
  return {
    hasPin: data?.has_pin ?? false,
    lockedUntil: data?.locked_until ?? null,
    attemptsLeft: data?.attempts_left ?? 5,
  };
}

/// Whether this browser has already presented the PIN.
///
/// Asked of the database rather than trusted from the cookie. The cookie is httpOnly, but
/// "the client sent a cookie" is not the same claim as "this token was issued, belongs to
/// this user, and has not expired" — and only the database can make the second one.
export async function isUnlocked(): Promise<boolean> {
  const token = (await cookies()).get(UNLOCK_COOKIE)?.value;
  if (!token) return false;
  const db = await supabaseServer();
  const { data } = await db.rpc("is_unlocked", { p_token: token });
  return data === true;
}

/// 256 bits. The PIN is four digits; this is what actually makes the unlock unguessable,
/// and it is why the PIN never has to be.
export function newUnlockToken(): string {
  return randomBytes(32).toString("hex");
}
