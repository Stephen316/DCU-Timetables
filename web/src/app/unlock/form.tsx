"use client";

import { useActionState, useRef, useState } from "react";
import { enterCode, signInWithEmail, type UnlockState } from "./actions";
import { Spinner } from "../(console)/spinner";

export function CodeForm() {
  const [state, action, pending] = useActionState<UnlockState, FormData>(enterCode, null);
  const form = useRef<HTMLFormElement>(null);

  return (
    <form ref={form} action={action}>
      <div className="field">
        <label htmlFor="code">Code</label>
        <input
          id="code"
          name="code"
          className="pin-input"
          type="password"
          inputMode="numeric"
          pattern="[0-9]{4}"
          maxLength={4}
          autoComplete="off"
          autoFocus
          required
          disabled={pending}
          // Four digits is the whole code, so the fourth submits it.
          onChange={(e) => {
            e.target.value = e.target.value.replace(/\D/g, "");
            if (e.target.value.length === 4) form.current?.requestSubmit();
          }}
        />
      </div>
      <button className="primary unlock-btn" type="submit" disabled={pending}>
        {pending ? <><Spinner /> Checking</> : "Open console"}
      </button>
      {state?.error && <p className="err">{state.error}</p>}
      <p className="dim lock-alt">
        <a href="/unlock?email">Sign in with email instead</a>
      </p>
    </form>
  );
}

export function EmailForm({ codeInstead }: { codeInstead: boolean }) {
  // Held here, not in the form's own fields: React clears those after every action, and the
  // second step needs the email and password again to send with the code.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<UnlockState, FormData>(async (prev, data) => {
    const result = await signInWithEmail(prev, data);
    // A wrong password is retyped; a password that was right and is waiting on the code is kept.
    if (result?.error && !result.needsTotp) setPassword("");
    return result;
  }, null);
  const secondStep = state?.needsTotp === true;

  return (
    <form ref={form} action={action}>
      {secondStep ? (
        <>
          <input type="hidden" name="email" value={email} />
          <input type="hidden" name="password" value={password} />
          <p className="dim" style={{ marginBottom: 12 }}>
            Enter the six-digit code from your authenticator app.
          </p>
          <div className="field">
            <label htmlFor="totp">Authenticator code</label>
            <input id="totp" name="totp" type="text" inputMode="numeric" maxLength={7}
                   autoComplete="one-time-code" autoFocus required disabled={pending}
                   // Six digits is the whole code, so the sixth submits it.
                   onChange={(e) => {
                     e.target.value = e.target.value.replace(/\D/g, "");
                     if (e.target.value.length === 6) form.current?.requestSubmit();
                   }} />
          </div>
        </>
      ) : (
        <>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="username" required
                   value={email} onChange={(e) => setEmail(e.target.value)}
                   autoFocus={!email} disabled={pending} />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required
                   value={password} onChange={(e) => setPassword(e.target.value)}
                   autoFocus={!!email} disabled={pending} />
          </div>
        </>
      )}
      <button className="primary unlock-btn" type="submit" disabled={pending}>
        {pending ? <><Spinner /> {secondStep ? "Checking" : "Signing in"}</> : secondStep ? "Verify" : "Sign in"}
      </button>
      {state?.error && <p className="err">{state.error}</p>}
      {secondStep ? (
        <p className="dim lock-alt">
          <a href="/unlock?email">Start again</a>
        </p>
      ) : (
        codeInstead && (
          <p className="dim lock-alt">
            <a href="/unlock">Use the code instead</a>
          </p>
        )
      )}
    </form>
  );
}
