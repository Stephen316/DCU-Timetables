"use client";

import { useActionState, useRef } from "react";
import { unlock, type UnlockState } from "./actions";
import { Spinner } from "../(console)/spinner";

export function UnlockForm() {
  const [state, action, pending] = useActionState<UnlockState, FormData>(unlock, null);
  const form = useRef<HTMLFormElement>(null);
  const locked = state?.attemptsLeft === 0;

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
          disabled={pending || locked}
          // Four digits is the whole code, so the fourth submits it.
          onChange={(e) => {
            e.target.value = e.target.value.replace(/\D/g, "");
            if (e.target.value.length === 4) form.current?.requestSubmit();
          }}
        />
      </div>
      <button className="primary unlock-btn" type="submit" disabled={pending || locked}>
        {pending ? <><Spinner /> Checking</> : "Open console"}
      </button>
      {state?.error && <p className="err">{state.error}</p>}
    </form>
  );
}
