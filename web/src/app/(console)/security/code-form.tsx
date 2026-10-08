"use client";

import { useActionState } from "react";
import { changeCode } from "./actions";
import { Spinner } from "../spinner";

export function CodeForm() {
  const [state, action, pending] = useActionState(changeCode, null as { error?: string; ok?: boolean } | null);

  return (
    <form action={action} style={{ maxWidth: 280 }}>
      <div className="field">
        <label htmlFor="code">New code</label>
        <input id="code" name="code" className="pin-input" type="password" inputMode="numeric"
               pattern="[0-9]{4}" maxLength={4} autoComplete="off" required disabled={pending} />
      </div>
      <div className="field">
        <label htmlFor="again">Again</label>
        <input id="again" name="again" className="pin-input" type="password" inputMode="numeric"
               pattern="[0-9]{4}" maxLength={4} autoComplete="off" required disabled={pending} />
      </div>
      {state?.error && <p className="err">{state.error}</p>}
      {state?.ok && <p className="tag ok">Changed. Browsers already open stay open; sign them out below if needed.</p>}
      <button className="primary" type="submit" disabled={pending}>
        {pending ? <><Spinner /> Saving</> : "Change code"}
      </button>
    </form>
  );
}
