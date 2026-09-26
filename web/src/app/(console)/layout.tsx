import { redirect } from "next/navigation";
import { consoleStatus } from "@/lib/auth/gate";
import { currentProfile } from "@/lib/supabase/server";
import { Nav } from "./nav";
import { lock, signOut } from "./actions";

/// The gate. Every console page is under this layout, so the check happens once and
/// cannot be forgotten on a new page.
///
/// For a student it is not the only gate — RLS refuses the queries too, and this exists so
/// one who guesses the URL sees a redirect rather than an empty table and a stack of 403s.
/// For an admin's browser that is locked, it is the gate: the code locks these pages, not
/// the account (supabase/phase22_remembered_console.sql says what that does and doesn't
/// protect).
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  // Two questions, in order: is this browser signed in as an admin, and has it been opened
  // here — by the code, or by signing in with email — in the last 12 hours? /unlock sorts
  // out which of the two ways in it needs.
  const profile = await currentProfile();
  if (!profile || profile.role !== "admin") redirect("/unlock");
  const status = await consoleStatus();
  if (!status?.unlocked) redirect("/unlock");

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="who">
          <strong>{profile.display_name || "Console"}</strong>
        </div>
        <Nav />
        <div className="row" style={{ marginTop: "auto", paddingTop: 16, alignItems: "center" }}>
          <form action={lock}>
            <button type="submit" title="Asks for the code again; this browser stays signed in">Lock</button>
          </form>
          <form action={signOut}>
            <button type="submit" className="link" title="Forgets this browser; it needs the email sign-in again">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
