"use client";

import { useActionState, useRef } from "react";
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
  const [state, action, pending] = useActionState<UnlockState, FormData>(signInWithEmail, null);

  return (
    <form action={action}>
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required
               defaultValue={state?.email} autoFocus={!state?.email} disabled={pending} />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required
               autoFocus={!!state?.email} disabled={pending} />
      </div>
      <button className="primary unlock-btn" type="submit" disabled={pending}>
        {pending ? <><Spinner /> Signing in</> : "Sign in"}
      </button>
      {state?.error && <p className="err">{state.error}</p>}
      {codeInstead && (
        <p className="dim lock-alt">
          <a href="/unlock">Use the code instead</a>
        </p>
      )}
    </form>
  );
}
