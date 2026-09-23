"use server";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { clientIpKey, consoleCredentials } from "@/lib/auth/gate";

export type UnlockState = { error?: string; attemptsLeft?: number } | null;

type Cookie = { name: string; value: string; options?: Record<string, unknown> };

/// Signs the server in as the console account, asks the database whether the code is right
/// for this IP, and only then gives the browser the session.
///
/// The session is opened into a jar held here, not into the response. A wrong code signs
/// that session out again and nothing reaches the browser; only a right one copies the
/// jar's cookies across.
export async function unlock(_prev: UnlockState, form: FormData): Promise<UnlockState> {
  const code = String(form.get("code") ?? "").trim();
  // Not a guess at all, so not counted.
  if (!/^[0-9]{4}$/.test(code)) return { error: "Enter the four digits." };

  const credentials = consoleCredentials();
  if (!credentials) {
    return {
      error: "The console isn't set up: CONSOLE_ADMIN_EMAIL and CONSOLE_ADMIN_PASSWORD are missing " +
        "from this server's environment.",
    };
  }

  const jar = new Map<string, Cookie>();
  const db = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => [...jar.values()].map(({ name, value }) => ({ name, value })),
        setAll: (list: Cookie[]) => list.forEach((c) => jar.set(c.name, c)),
      },
    },
  );

  const { error: signInError } = await db.auth.signInWithPassword(credentials);
  if (signInError) {
    return { error: `The console's account couldn't sign in (${signInError.message}). Check CONSOLE_ADMIN_EMAIL and CONSOLE_ADMIN_PASSWORD.` };
  }

  const { data, error } = await db
    .rpc("check_console_code", { p_code: code, p_ip: await clientIpKey() })
    .maybeSingle<{ status: string; attempts_left: number }>();

  if (!error && data?.status === "ok") {
    const store = await cookies();
    for (const c of jar.values()) store.set(c.name, c.value, c.options);
    redirect("/review");
  }

  // Anything but a right code: the session the server opened is ended, not handed over.
  await db.auth.signOut({ scope: "local" });

  if (error) {
    return {
      error: error.message.includes("not allowed")
        ? "The console's account isn't an admin."
        : `Couldn't check the code (${error.message}).`,
    };
  }
  switch (data?.status) {
    case "wrong":
      return {
        error: data.attempts_left > 0
          ? `Wrong code. ${data.attempts_left} ${data.attempts_left === 1 ? "try" : "tries"} left from this network.`
          : "Wrong code. This network is locked for 24 hours.",
        attemptsLeft: data.attempts_left,
      };
    case "ip_locked":
      return { error: "Too many wrong codes from this network. Try again in 24 hours, or from another network.", attemptsLeft: 0 };
    case "locked":
      return {
        error: "The console is locked after too many wrong codes. Unlock it in the Supabase SQL editor: " +
          "select private.unlock_console();",
        attemptsLeft: 0,
      };
    case "no_code":
      return { error: "No code has been set. In the Supabase SQL editor: select private.set_console_code('1234');" };
    default:
      return { error: "Couldn't check the code." };
  }
}
