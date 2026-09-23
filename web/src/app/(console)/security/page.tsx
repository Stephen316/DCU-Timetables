import { supabaseServer } from "@/lib/supabase/server";
import { CodeForm } from "./code-form";
import { lockEverywhere } from "./actions";

export default async function SecurityPage() {
  const db = await supabaseServer();
  const { data } = await db.rpc("console_code_status").maybeSingle<{
    has_code: boolean; locked: boolean; wrong_today: number;
  }>();

  return (
    <>
      <div className="head">
        <h1>Security</h1>
        <p>The console opens with a four-digit code. There is no other sign-in.</p>
      </div>

      <p className="dim" style={{ marginBottom: 20 }}>
        Wrong codes in the last 24 hours: <span className="mono">{data?.wrong_today ?? 0}</span> of the 10 that
        lock the console for everyone.
      </p>

      <h2 style={{ marginTop: 8 }}>Change the code</h2>
      <CodeForm />

      <h2 style={{ marginTop: 28 }}>Lock every browser</h2>
      <p className="dim" style={{ marginBottom: 12 }}>
        Closes the console everywhere it is open, including here. Use it if a device is lost or
        the code may have been seen — then change the code.
      </p>
      <form action={lockEverywhere}>
        <button type="submit" className="danger">Lock every browser</button>
      </form>

      <h2 style={{ marginTop: 28 }}>How the code is protected</h2>
      <ul className="dim" style={{ fontSize: 13, lineHeight: 1.7, paddingLeft: 18 }}>
        <li>Three wrong codes from one network lock that network for 24 hours.</li>
        <li>
          Ten wrong codes in 24 hours from all networks together lock the console for everyone.
          Without this, someone with many addresses could try all 10,000 codes.
        </li>
        <li>
          To unlock after that, or if the code is forgotten, run in the Supabase SQL editor:{" "}
          <span className="mono">select private.unlock_console();</span> or{" "}
          <span className="mono">select private.set_console_code(&apos;1234&apos;);</span>
        </li>
        <li>A browser that has entered the code stays open until you press Lock.</li>
      </ul>
    </>
  );
}
