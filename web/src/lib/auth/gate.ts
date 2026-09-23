import "server-only";
import { headers } from "next/headers";

/// The console opens with a 4-digit code and nothing else. Behind it, the server signs in
/// as the admin account using credentials held only in its environment — you never type
/// them, and a browser never receives them. The code decides whether the session the
/// server opened is handed to the browser. See supabase/phase15_console_code.sql for the
/// limits that make four digits defensible.

export function consoleCredentials(): { email: string; password: string } | null {
  const email = process.env.CONSOLE_ADMIN_EMAIL?.trim();
  const password = process.env.CONSOLE_ADMIN_PASSWORD;
  return email && password ? { email, password } : null;
}

/// Which address a guess came from, for the per-IP limit.
///
/// On Vercel, `x-real-ip` is set by the platform from the connection itself and cannot be
/// supplied by the client, which is what makes it usable for a limit. `x-forwarded-for`
/// is the fallback for other hosts; its first entry is the client.
///
/// IPv6 is cut to its /64. One home connection holds 2^64 addresses, so counting them
/// singly would hand anyone on IPv6 unlimited tries.
export async function clientIpKey(): Promise<string> {
  const h = await headers();
  const raw = (h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0] ?? "").trim();
  return ipKey(raw);
}

export function ipKey(raw: string): string {
  const ip = raw.replace(/^::ffff:/i, "");
  if (!ip) return "unknown";
  if (!ip.includes(":")) return ip;
  // Expand "::" so the first four groups are the real first four.
  const [head, tail = ""] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = ip.includes("::") && tail ? tail.split(":") : [];
  const groups = ip.includes("::")
    ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right]
    : ip.split(":");
  return `${groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, "")).join(":")}::/64`;
}
