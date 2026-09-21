"use client";

import { useState, useTransition } from "react";
import { verifyDeadline } from "../actions";

const dateFormat = new Intl.DateTimeFormat("en-IE", {
  weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
});

export function ReviewRow({
  deadline,
  confirmations,
}: {
  deadline: { id: string; module_key: string; title: string; due_at: string; kind: string };
  confirmations: number;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const due = new Date(deadline.due_at);
  const isPast = due.getTime() < Date.now();
  // Missing a quiz or an exam is unrecoverable, so they are marked here rather than
  // sitting in the list looking like an essay.
  const satInClass = deadline.kind === "quiz" || deadline.kind === "exam";

  function decide(status: "verified" | "rejected") {
    start(async () => {
      const result = await verifyDeadline(deadline.id, status);
      setError(result.error ?? null);
    });
  }

  return (
    <tr>
      <td className="mono">{deadline.module_key}</td>
      <td>
        {deadline.title}
        {error && <div className="err">{error}</div>}
      </td>
      <td className={isPast ? "tag off" : undefined}>
        {dateFormat.format(due)}
        {isPast && " · past"}
      </td>
      <td className={satInClass ? "tag warn" : "dim"}>{deadline.kind}</td>
      <td className="right dim">{confirmations}</td>
      <td className="right" style={{ whiteSpace: "nowrap" }}>
        <button onClick={() => decide("verified")} disabled={pending}>Verify</button>{" "}
        <button className="danger" onClick={() => decide("rejected")} disabled={pending}>Reject</button>
      </td>
    </tr>
  );
}
