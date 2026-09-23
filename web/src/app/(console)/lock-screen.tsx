"use client";

import { useActionState, useEffect, useRef } from "react";
import { unlock } from "./security/actions";

/// Shown instead of the console when a PIN is set and this browser has not presented it.
///
/// Not a sign-in page, and it says so: you are already authenticated, this releases the
/// session on this device. Getting it wrong costs four digits, not a password.
export function LockScreen({ email }: { email: string }) {
  const [state, action, pending] = useActionState(unlock, null as { error?: string; ok?: boolean } | null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { if (state?.error) { if (input.current) input.current.value = ""; input.current?.focus(); } }, [state]);

  return (
    <div className="lock">
      <div className="lock-card">
        <h1>Locked</h1>
        <p className="dim">
          Signed in as {email}. Enter your PIN to continue.
        </p>
        <form action={action}>
          <div className="field">
            <label htmlFor="pin">PIN</label>
            <input
              ref={input}
              id="pin"
              name="pin"
              className="pin-input"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              pattern="[0-9]{4}"
              maxLength={4}
              required
              disabled={pending}
            />
          </div>
          {state?.error && <p className="err">{state.error}</p>}
          <button className="primary" type="submit" disabled={pending}>
            {pending ? "Checking…" : "Unlock"}
          </button>
        </form>
        <p className="dim" style={{ fontSize: 12, marginTop: 16 }}>
          Forgotten it? <a href="/login">Sign in with your password</a> and set a new one.
        </p>
      </div>
    </div>
  );
}
