"use client";

import { useState, useTransition } from "react";
import { resolveFlag } from "../actions";

export function ResolveFlag({ id }: { id: number }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button disabled={pending} onClick={() => start(async () => setError((await resolveFlag(id)).error ?? null))}>
        Mark resolved
      </button>
      {error && <div className="err">{error}</div>}
    </>
  );
}
