"use server";

import { createServerClient } from "@supabase/ssr";
import type { AuthError } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

/// `email` comes back so a wrong password doesn't also clear the address: React resets a form
/// after its action runs.
export type UnlockState = { error?: string; attemptsLeft?: number; email?: string } | null;

type Cookie = { name: string; value: string; options?: Record<string, unknown> };

/// The four-digit code, on a browser that has signed in with email in the last 30 days.
/// The database counts the tries against this browser's session and ends it at five.
export async function enterCode(_prev: UnlockState, form: FormData): Promise<UnlockState> {
  const code = String(form.get("code") ?? "").trim();
  // Not a guess at all, so not counted.
  if (!/^[0-9]{4}$/.test(code)) return { error: "Enter the four digits." };

  const db = await supabaseServer();
  const { data, error } = await db
    .rpc("enter_console_code", { p_code: code })
    .maybeSingle<{ status: string; attempts_left: number }>();

  if (error) {
    // No admin session left to try it against — ended elsewhere, or no longer an admin.
    // Anything else is the check failing, which is no reason to sign anyone out.
    if (error.code === "42501" || error.message.includes("not allowed")) {
      await db.auth.signOut({ scope: "local" });
      redirect("/unlock");
    }
    return { error: `Couldn't check the code (${error.message}).` };
  }

  switch (data?.status) {
    case "ok":
      redirect("/review");
    case "wrong": {
      const left = data.attempts_left;
      return {
        error: `Wrong code. ${left} ${left === 1 ? "try" : "tries"} left before this browser is signed out.`,
        attemptsLeft: left,
      };
    }
    // The database has already ended the session; this clears its cookies.
    case "signed_out":
      await db.auth.signOut({ scope: "local" });
      redirect("/unlock?ended=codes");
    case "expired":
      await db.auth.signOut({ scope: "local" });
      redirect("/unlock?ended=expired");
    case "no_code":
      redirect("/unlock?email");
    default:
      return { error: "Couldn't check the code." };
  }
}

/// Email and password: the way in on a new browser, after five wrong codes, or when the
/// code is forgotten. It opens the console without the code.
///
/// The new session is opened into a jar held here, not into the response. Only once the
/// database has agreed it is an admin's does the browser get it — a student who tries
/// their own account here leaves with nothing stored.
export async function signInWithEmail(_prev: UnlockState, form: FormData): Promise<UnlockState> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password.", email };

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

  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) return { error: signInMessage(signInError), email };

  const { data: opened, error } = await db.rpc("open_console_session");
  if (error || opened !== true) {
    await db.auth.signOut({ scope: "local" });
    return {
      error: error?.message.includes("not allowed")
        ? "That account isn't a console admin."
        : `Signed in, but couldn't open the console (${error?.message ?? "try again"}).`,
      email,
    };
  }

  // Whatever session this browser held before is ended, not left behind — but only now,
  // so a mistyped password doesn't cost a remembered browser.
  const previous = await supabaseServer();
  await previous.auth.signOut({ scope: "local" });

  const store = await cookies();
  for (const c of jar.values()) store.set(c.name, c.value, c.options);
  redirect("/review");
}

function signInMessage(error: AuthError): string {
  switch (error.code) {
    case "invalid_credentials":
      return "Wrong email or password.";
    case "email_not_confirmed":
      return "That email hasn't been confirmed yet. Use the link Supabase sent to it.";
    case "over_request_rate_limit":
      return "Too many sign-ins. Wait a few minutes, then try again.";
    default:
      return `Couldn't sign in (${error.message}).`;
  }
}
