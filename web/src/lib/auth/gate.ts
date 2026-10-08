import "server-only";
import { currentProfile, supabaseServer } from "@/lib/supabase/server";

/// Two ways into the console (supabase/phase22_remembered_console.sql):
///
///   * Email and password, once per browser. Supabase's session cookie then remembers the
///     browser for 30 days, and signing in this way opens the console straight away.
///   * The four-digit code, on a remembered browser. A right code opens the console there
///     for 12 hours, or until Lock; five wrong ones sign the browser out.
///
/// Whether this browser is open is the database's answer, not a cookie's. The unlock
/// belongs to the Supabase session, and only the database knows whether it has been
/// locked, has run out, or was ended by wrong codes.
export type ConsoleStatus = {
  unlocked: boolean;
  /// Signed in with email within 30 days, so the code may be tried here.
  remembered: boolean;
  hasCode: boolean;
  attemptsLeft: number;
};

/// Null when this browser holds no admin session at all. Ask only after `currentProfile()`
/// has found an admin: without a session the database refuses the question outright.
export async function consoleStatus(): Promise<ConsoleStatus | null> {
  const db = await supabaseServer();
  const { data, error } = await db.rpc("console_session_status").maybeSingle<{
    unlocked: boolean; remembered: boolean; has_code: boolean; attempts_left: number;
  }>();
  if (error) throw new Error(`Could not check whether the console is open: ${error.message}`);
  if (!data) return null;
  return {
    unlocked: data.unlocked,
    remembered: data.remembered,
    hasCode: data.has_code,
    attemptsLeft: data.attempts_left,
  };
}

/// True for an admin in a browser whose console is open. Every Server Action asks this: an
/// action is reachable by POST without the page that hosts it, so the page's lock alone
/// would leave every action open on a locked browser.
export async function consoleOpen(): Promise<boolean> {
  const profile = await currentProfile();
  if (profile?.role !== "admin") return false;
  return (await consoleStatus())?.unlocked === true;
}
