import { redirect } from "next/navigation";
import { currentProfile } from "@/lib/supabase/server";
import { UnlockForm } from "./form";

/// The only way into the console: four digits. There is no sign-in page and no password —
/// the server holds the account and the code decides whether this browser may use it.
export default async function UnlockPage() {
  // Already in: straight through. A failure to tell is not "in", so it shows the form.
  const profile = await currentProfile().catch(() => null);
  if (profile?.role === "admin") redirect("/review");

  return (
    <div className="lock">
      <div className="lock-card">
        <h1>Console</h1>
        <p className="dim">Enter the four-digit code.</p>
        <UnlockForm />
      </div>
    </div>
  );
}
