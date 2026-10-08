import { redirect } from "next/navigation";
import { consoleStatus } from "@/lib/auth/gate";
import { currentProfile } from "@/lib/supabase/server";
import { CodeForm, EmailForm } from "./form";

const ENDED: Record<string, string> = {
  codes: "Five wrong codes signed this browser out. Sign in with email to use it again.",
  expired: "This browser signed in more than 30 days ago. Sign in with email again.",
};

/// The way into the console. A remembered browser is asked for the four-digit code; any
/// other browser, or one that chooses to, signs in with email and password.
export default async function UnlockPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; ended?: string }>;
}) {
  const params = await searchParams;

  // Already open: straight through. A failure to tell is not "open", so it shows a form.
  const profile = await currentProfile().catch(() => null);
  const status = profile?.role === "admin" ? await consoleStatus().catch(() => null) : null;
  if (status?.unlocked) redirect("/review");

  // The code needs an admin's remembered session to be tried against. Without one, and
  // until a code has been set on the Security page, email is the only way in.
  const codeUsable = !!status?.remembered && status.hasCode;
  const showCode = codeUsable && params.email === undefined;
  const notice = params.ended ? ENDED[params.ended]
    : status?.remembered && !status.hasCode ? "No code has been set. Sign in with email, then set one on the Security page."
    : null;

  return (
    <div className="lock">
      <div className="lock-card">
        <h1>Console</h1>
        <p className="dim">{showCode ? "Enter the four-digit code." : "Sign in with your admin account."}</p>
        {notice && !showCode && <p className="err">{notice}</p>}
        {showCode ? <CodeForm /> : <EmailForm codeInstead={codeUsable} />}
      </div>
    </div>
  );
}
