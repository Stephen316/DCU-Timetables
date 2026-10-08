"use client";

import { useState, useTransition } from "react";
import { editDeadline, moderateDeadline } from "../actions";

export type ConsoleDeadline = {
  id: string;
  module_key: string;
  title: string;
  due_at: string;
  kind: string;
  /** Whole percent of the grade; 0 is not graded. */
  grade_weight: number;
  status: "pending" | "verified" | "rejected";
  source: string;
  submitted_at: string;
  edited_at: string | null;
  submitter_id: string;
  confirmations: number;
  disputes: number;
  reports: number;
  /** The poster's student ID, when the account still exists. */
  poster: string | null;
};

const KINDS: Record<string, string> = {
  assignment: "Assignment", labReport: "Lab report", quiz: "Quiz", exam: "Exam", presentation: "Presentation", other: "Other",
};

// Pinned to Dublin so the server's render and the browser's agree whatever zone either is in.
const dateFormat = new Intl.DateTimeFormat("en-IE", {
  weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Dublin",
});

/// The app's wording, so a 0 reads the same in both places.
function worth(weight: number): string {
  return weight > 0 ? `${weight}%` : "not graded";
}

/// `datetime-local` wants the browser's wall-clock time with no zone.
function localInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function DeadlineRow({ deadline }: { deadline: ConsoleDeadline }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(deadline.title);
  const [kind, setKind] = useState(deadline.kind);
  const [due, setDue] = useState("");
  const [weight, setWeight] = useState("");
  const weightValue = weight.trim() === "" ? 0 : /^\d{1,3}$/.test(weight.trim()) ? Number(weight) : NaN;
  const weightOK = weightValue >= 0 && weightValue <= 100;

  const isPast = new Date(deadline.due_at).getTime() < Date.now();
  // Missing a quiz or an exam is unrecoverable, so they are marked here rather than
  // sitting in the list looking like an essay.
  const satInClass = deadline.kind === "quiz" || deadline.kind === "exam";
  const disputed = deadline.disputes > 0 && deadline.disputes >= deadline.confirmations;

  function run(fn: () => Promise<{ error?: string }>, after?: () => void) {
    start(async () => {
      const result = await fn();
      setError(result.error ?? null);
      if (!result.error) after?.();
    });
  }

  function openEditor() {
    setTitle(deadline.title);
    setKind(deadline.kind);
    setDue(localInput(deadline.due_at));
    setWeight(deadline.grade_weight > 0 ? String(deadline.grade_weight) : "");
    setError(null);
    setEditing(true);
  }

  const dueChanged = due !== "" && new Date(due).getTime() !== new Date(deadline.due_at).getTime();
  const clearsVouches = (dueChanged || kind !== deadline.kind) && deadline.confirmations > 0;

  if (editing) {
    return (
      <tr>
        <td className="mono">{deadline.module_key}</td>
        <td colSpan={10}>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <div className="field" style={{ flex: 2, minWidth: 220, marginBottom: 0 }}>
              <label htmlFor={`t-${deadline.id}`}>Title</label>
              <input id={`t-${deadline.id}`} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor={`k-${deadline.id}`}>Kind</label>
              <select id={`k-${deadline.id}`} value={kind} onChange={(e) => setKind(e.target.value)}>
                {Object.entries(KINDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor={`d-${deadline.id}`}>Due</label>
              <input id={`d-${deadline.id}`} type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
            <div className="field" style={{ marginBottom: 0, width: 110 }}>
              <label htmlFor={`w-${deadline.id}`}>Worth (%)</label>
              <input
                id={`w-${deadline.id}`}
                inputMode="numeric"
                value={weight}
                placeholder="0"
                maxLength={3}
                onChange={(e) => setWeight(e.target.value)}
              />
            </div>
            <button
              className="primary"
              disabled={pending || title.trim() === "" || due === "" || !weightOK}
              onClick={() => run(
                () => editDeadline(deadline.id, title.trim(), kind, new Date(due).toISOString(), weightValue),
                () => setEditing(false),
              )}
            >
              Save
            </button>
            <button disabled={pending} onClick={() => setEditing(false)}>Cancel</button>
          </div>
          <div className="dim" style={{ marginTop: 8, fontSize: 12 }}>
            {weightOK ? `Worth: ${worth(weightValue)}. 0 or blank means not graded.` : "Worth must be a whole number from 0 to 100."}
          </div>
          {clearsVouches && (
            <div className="tag warn" style={{ marginTop: 8 }}>
              Changing the date or kind clears its {deadline.confirmations} confirmation
              {deadline.confirmations === 1 ? "" : "s"}.
            </div>
          )}
          {error && <div className="err">{error}</div>}
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td className="mono">{deadline.module_key}</td>
      <td>
        {deadline.title}
        {deadline.edited_at && <span className="dim"> · edited</span>}
        {deadline.source !== "student" && <span className="dim"> · {deadline.source}</span>}
        {error && <div className="err">{error}</div>}
      </td>
      <td className={isPast ? "tag off" : undefined} style={{ whiteSpace: "nowrap" }}>
        {dateFormat.format(new Date(deadline.due_at))}
        {isPast && " · past"}
      </td>
      <td className={satInClass ? "tag warn" : "dim"}>{KINDS[deadline.kind] ?? deadline.kind}</td>
      <td className="right dim" style={{ whiteSpace: "nowrap" }}>{worth(deadline.grade_weight)}</td>
      <td>
        {deadline.status === "verified" && <span className="tag ok">confirmed</span>}
        {deadline.status === "rejected" && <span className="tag off">blocked</span>}
        {deadline.status === "pending" && <span className="dim">waiting</span>}
      </td>
      <td className="right dim">{deadline.confirmations}</td>
      <td className={disputed ? "right tag warn" : "right dim"}>{deadline.disputes}</td>
      <td className={deadline.reports > 0 ? "right tag off" : "right dim"}>{deadline.reports}</td>
      <td className="mono dim">{deadline.poster ?? "--"}</td>
      <td className="right" style={{ whiteSpace: "nowrap" }}>
        <button disabled={pending} onClick={openEditor}>Edit</button>{" "}
        {deadline.status !== "verified" && (
          <>
            <button disabled={pending} onClick={() => run(() => moderateDeadline(deadline.id, "confirm"))}>Confirm</button>{" "}
          </>
        )}
        {deadline.status === "rejected" ? (
          <button disabled={pending} onClick={() => run(() => moderateDeadline(deadline.id, "unblock"))}>Unblock</button>
        ) : (
          <button className="danger" disabled={pending} onClick={() => run(() => moderateDeadline(deadline.id, "block"))}>
            Block
          </button>
        )}{" "}
        <button
          className="danger"
          disabled={pending}
          onClick={() => {
            if (!window.confirm(`Delete “${deadline.title}” for good? Its confirmations and reports go with it. Block it instead to catch it being posted again.`)) return;
            run(() => moderateDeadline(deadline.id, "remove"));
          }}
        >
          Remove
        </button>
      </td>
    </tr>
  );
}
