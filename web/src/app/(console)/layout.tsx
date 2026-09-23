import { redirect } from "next/navigation";
import { currentProfile } from "@/lib/supabase/server";
import { pinStatus, isUnlocked } from "@/lib/auth/pin";
import { LockScreen } from "./lock-screen";
import { Nav } from "./nav";
import { signOut } from "./actions";

/// The gate. Every console page is under this layout, so the check happens once and
/// cannot be forgotten on a new page.
///
/// It is not the only gate — RLS refuses the queries too. This one exists so a student
/// who guesses the URL sees a redirect rather than an empty table and a stack of 403s.
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const profile = await currentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "admin") redirect("/login?denied=1");

  // The PIN gate sits after the session gate, never instead of it. Someone without a
  // session never reaches this line, so the four digits are only ever a second factor on
  // a browser that already passed the first.
  //
  // No PIN set means no lock. The alternative — defaulting to locked — would lock the
  // console with a PIN nobody has chosen, and the way out of that is a database edit.
  const { hasPin } = await pinStatus();
  if (hasPin && !(await isUnlocked())) return <LockScreen email={profile.email} />;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="who">
          <strong>{profile.display_name || "Console"}</strong>
          {profile.email}
        </div>
        <Nav />
        <form action={signOut} style={{ marginTop: "auto", paddingTop: 16 }}>
          <button type="submit">Sign out</button>
        </form>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
