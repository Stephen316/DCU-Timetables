"use client";

import { useState, useTransition } from "react";
import { resolveReports, setBan } from "../actions";

export type Reported = {
  deadline: { id: string; module_key: string; title: string; status: string; submitter_id: string };
  reasons: Record<string, number>;
  first: string;
};

const reasonLabel: Record<string, string> = {
  offensive: "offensive", spam: "spam", wrong: "wrong details", other: "other",
};

const when = new Intl.DateTimeFormat("en-IE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/// One reported deadline. Keep closes the reports and leaves it up; Remove rejects it; the
/// third also bans whoever posted it for 30 days, the same ban the People page gives.
export function ReportedRow({ reported }: { reported: Reported }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { deadline } = reported;

  function run(fn: () => Promise<{ error?: string }>) {
    start(async () => setError((await fn()).error ?? null));
  }

  return (
    <tr>
      <td className="mono">{deadline.module_key}</td>
      <td>
        {deadline.title}
        {deadline.status === "verified" && <span className="dim"> · verified</span>}
        {error && <div className="err">{error}</div>}
      </td>
      <td>
        {Object.entries(reported.reasons)
          .map(([reason, n]) => `${reasonLabel[reason] ?? reason}${n > 1 ? ` ×${n}` : ""}`)
          .join(", ")}
      </td>
      <td className="dim">{when.format(new Date(reported.first))}</td>
      <td className="right" style={{ whiteSpace: "nowrap" }}>
        <button disabled={pending} onClick={() => run(() => resolveReports(deadline.id, "dismiss"))}>
          Keep
        </button>{" "}
        <button className="danger" disabled={pending} onClick={() => run(() => resolveReports(deadline.id, "remove"))}>
          Remove
        </button>{" "}
        <button
          className="danger"
          disabled={pending}
          onClick={() => {
            if (!window.confirm("Remove this deadline and ban the account that posted it for 30 days?")) return;
            run(async () => {
              const removed = await resolveReports(deadline.id, "remove");
              if (removed.error) return removed;
              return setBan(deadline.submitter_id, 30, "Reported content");
            });
          }}
        >
          Remove + ban
        </button>
      </td>
    </tr>
  );
}
