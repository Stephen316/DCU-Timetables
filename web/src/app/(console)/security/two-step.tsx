"use client";

import { useActionState } from "react";
import { confirmTwoStep, startTwoStep, type TwoStepDone, type TwoStepSetup } from "./actions";
import { Spinner } from "../spinner";

/// Setting up the authenticator app: start, scan the code, type back what the app shows.
export function TwoStepForm({ enabled }: { enabled: boolean }) {
  const [started, start, starting] = useActionState<TwoStepSetup>(startTwoStep, null);
  const [finished, finish, finishing] = useActionState<TwoStepDone, FormData>(confirmTwoStep, null);

  if (enabled || finished?.ok) {
    return <p className="tag ok">On. Signing in to the console asks for the code from your authenticator app.</p>;
  }

  if (!started?.setup) {
    return (
      <form action={start}>
        {started?.error && <p className="err" style={{ marginBottom: 12 }}>{started.error}</p>}
        <button className="primary" type="submit" disabled={starting}>
          {starting ? <><Spinner /> Starting</> : "Set up two-step sign-in"}
        </button>
      </form>
    );
  }

  const { factorId, qr, secret } = started.setup;
  return (
    <form action={finish} style={{ maxWidth: 320 }}>
      <p className="dim" style={{ marginBottom: 12 }}>
        Scan this with an authenticator app (1Password, Google Authenticator, Authy), or type the
        key in by hand. Then enter the six digits it shows.
      </p>
      {/* An image the sign-in service made, as a data: URL — nothing is fetched. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qr} alt="QR code for the authenticator app" width={180} height={180}
           style={{ background: "#fff", padding: 8, borderRadius: 6, marginBottom: 12 }} />
      <p className="dim" style={{ marginBottom: 12 }}>
        Key: <span className="mono">{secret}</span>
      </p>
      <input type="hidden" name="factorId" value={factorId} />
      <div className="field">
        <label htmlFor="twostep-code">Code from the app</label>
        <input id="twostep-code" name="code" type="text" inputMode="numeric" pattern="[0-9 ]{6,7}"
               maxLength={7} autoComplete="one-time-code" required disabled={finishing} />
      </div>
      {finished?.error && <p className="err">{finished.error}</p>}
      <button className="primary" type="submit" disabled={finishing}>
        {finishing ? <><Spinner /> Checking</> : "Turn on"}
      </button>
    </form>
  );
}
