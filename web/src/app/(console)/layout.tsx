import { redirect } from "next/navigation";
import { currentProfile } from "@/lib/supabase/server";
import { Nav } from "./nav";
import { signOut } from "./actions";

/// The gate. Every console page is under this layout, so the check happens once and
/// cannot be forgotten on a new page.
///
/// It is not the only gate — RLS refuses the queries too. This one exists so a student
/// who guesses the URL sees a redirect rather than an empty table and a stack of 403s.
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  // A session exists only once the four-digit code has been accepted (/unlock), so "no
  // session" and "not an admin" both mean the same thing here: enter the code.
  const profile = await currentProfile();
  if (!profile || profile.role !== "admin") redirect("/unlock");

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="who">
          <strong>{profile.display_name || "Console"}</strong>
        </div>
        <Nav />
        <form action={signOut} style={{ marginTop: "auto", paddingTop: 16 }}>
          <button type="submit">Lock</button>
        </form>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
