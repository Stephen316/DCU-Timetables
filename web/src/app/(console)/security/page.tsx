import { supabaseServer } from "@/lib/supabase/server";
import { CodeForm } from "./code-form";
import { signOutEverywhere } from "./actions";

export default async function SecurityPage() {
  const db = await supabaseServer();
  const { data } = await db.rpc("console_code_status").maybeSingle<{
    has_code: boolean; wrong_today: number;
  }>();

  return (
    <>
      <div className="head">
        <h1>Security</h1>
        <p>
          A browser signs in once with email and password. After that it asks only for the
          four-digit code.
        </p>
      </div>

      <p className="dim" style={{ marginBottom: 20 }}>
        Wrong codes in the last 24 hours: <span className="mono">{data?.wrong_today ?? 0}</span>.
        Five in one browser sign it out.
      </p>

      <h2 style={{ marginTop: 8 }}>{data?.has_code === false ? "Set the code" : "Change the code"}</h2>
      <CodeForm />

      <h2 style={{ marginTop: 28 }}>Sign out every browser</h2>
      <p className="dim" style={{ marginBottom: 12 }}>
        Ends the console in every browser that has opened it, including this one. Each needs the
        email sign-in again. The app stays signed in. Use it if a device is lost or the code may
        have been seen, then change the code.
      </p>
      <form action={signOutEverywhere}>
        <button type="submit" className="danger">Sign out every browser</button>
      </form>

      <h2 style={{ marginTop: 28 }}>How the code is protected</h2>
      <ul className="dim" style={{ fontSize: 13, lineHeight: 1.7, paddingLeft: 18 }}>
        <li>
          The code can only be tried in a browser that has signed in with an admin&apos;s email
          and password. Nobody else gets a single guess.
        </li>
        <li>Five wrong codes sign that browser out.</li>
        <li>
          A browser is remembered for 30 days from its email sign-in. A right code opens it for
          12 hours, or until Lock.
        </li>
        <li>Forgotten the code? Sign in with email, then change it here.</li>
        <li>
          The code locks these pages, not the account. Anyone who can copy this browser&apos;s
          cookies doesn&apos;t need it, so sign out on a computer that isn&apos;t yours.
        </li>
      </ul>
    </>
  );
}
