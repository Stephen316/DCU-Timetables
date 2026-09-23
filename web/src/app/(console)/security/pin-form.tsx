"use client";

import { useActionState } from "react";
import { setPin } from "./actions";

export function PinForm({ hasPin }: { hasPin: boolean }) {
  const [state, action, pending] = useActionState(setPin, null as { error?: string; ok?: boolean } | null);

  return (
    <form action={action} style={{ maxWidth: 280 }}>
      <div className="field">
        <label htmlFor="pin">{hasPin ? "New PIN" : "PIN"}</label>
        <input id="pin" name="pin" type="password" inputMode="numeric"
               pattern="[0-9]{4}" maxLength={4} autoComplete="off" required disabled={pending} />
      </div>
      <div className="field">
        <label htmlFor="again">Again</label>
        <input id="again" name="again" type="password" inputMode="numeric"
               pattern="[0-9]{4}" maxLength={4} autoComplete="off" required disabled={pending} />
      </div>
      {state?.error && <p className="err">{state.error}</p>}
      {state?.ok && <p className="tag ok">Saved. You will be asked for it on the next page.</p>}
      <button className="primary" type="submit" disabled={pending}>
        {pending ? "Saving…" : hasPin ? "Change PIN" : "Set PIN"}
      </button>
    </form>
  );
}
