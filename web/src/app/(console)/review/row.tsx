"use client";

import { useState, useTransition } from "react";
import { verifyDeadline } from "../actions";
import { Spinner } from "../spinner";

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
  const [decision, setDecision] = useState<"verified" | "rejected" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const due = new Date(deadline.due_at);
  const isPast = due.getTime() < Date.now();
  // Missing a quiz or an exam is unrecoverable, so they are marked here rather than
  // sitting in the list looking like an essay.
  const satInClass = deadline.kind === "quiz" || deadline.kind === "exam";

  function decide(status: "verified" | "rejected") {
    if (status === "rejected" && !window.confirm(`Reject "${deadline.title}"? It leaves every student's view. This can't be undone.`)) return;
    setDecision(status);
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
        <button onClick={() => decide("verified")} disabled={pending}>
          {pending && decision !== "rejected" ? <><Spinner /> Verifying</> : "Verify"}
        </button>{" "}
        <button className="danger" onClick={() => decide("rejected")} disabled={pending}>
          {pending && decision === "rejected" ? <><Spinner /> Rejecting</> : "Reject"}
        </button>
      </td>
    </tr>
  );
}
