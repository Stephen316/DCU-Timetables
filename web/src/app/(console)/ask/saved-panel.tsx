"use client";

import { useEffect, useState } from "react";
import { listSaved, type SavedView } from "./saved";
import { moduleFor, programmeFor } from "@/lib/proposals/courses";
import { Spinner } from "../spinner";

/// What is already live for the selected programme and module, under the chat. Each entry
/// opens to show what was saved — the thing a new proposal would replace.
export function SavedPanel({ programme, module, refresh }: { programme: string; module: string; refresh: number }) {
  const [view, setView] = useState<SavedView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    listSaved(programme, module)
      .then((r) => {
        if (!current) return;
        if (r.ok) setView(r.view);
        else setError(r.error);
      })
      .catch((e) => current && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => current && setLoading(false));
    // A newer selection supersedes this one; its answer must not land on top.
    return () => { current = false; };
  }, [programme, module, refresh]);

  const scope = module
    ? `${module}${moduleFor(module) ? ` · ${moduleFor(module)!.title}` : ""}`
    : programmeFor(programme)?.name ?? programme;
  const empty = view && !view.rotation && view.splits.length === 0 && !view.classList;

  return (
    <section className="saved" aria-labelledby="saved-heading">
      <div className="saved-head">
        <h2 id="saved-heading">Saved</h2>
        <span className="dim">{scope}</span>
        {loading && <Spinner />}
      </div>

      {error && <p className="err">{error}</p>}
      {empty && !loading && (
        <p className="dim" style={{ fontSize: 13 }}>
          Nothing saved for {module ? "this module" : "this programme"} yet.
        </p>
      )}

      {view?.rotation && (
        <Entry
          title="Lab rotation"
          meta={`${module ? `${view.rotation.sessions.length} of ${view.rotation.total}` : view.rotation.total} sessions · v${view.rotation.version} · ${when(view.rotation.savedAt)}`}
        >
          {view.rotation.sessions.length === 0 ? (
            <p className="dim" style={{ fontSize: 13 }}>
              The programme&rsquo;s rotation has no sessions for {module}.
            </p>
          ) : (
            <div className="saved-scroll">
              <table>
                <thead><tr><th>Wk</th><th>Date</th><th>Day</th><th>Time</th><th>Module</th><th>Activity</th><th>Groups</th></tr></thead>
                <tbody>
                  {view.rotation.sessions.map((s, i) => (
                    <tr key={i}>
                      <td>{s.week ?? "—"}</td><td className="mono">{s.date ?? "—"}</td><td>{s.day ?? "—"}</td>
                      <td className="mono">{s.start && s.end ? `${s.start}–${s.end}` : "—"}</td>
                      <td className="mono">{s.module ?? "—"}</td><td>{s.activity ?? "—"}</td><td>{s.groups.join(" ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Entry>
      )}

      {view?.splits.map((sp) => (
        <Entry
          key={`${sp.module}-${sp.activity}`}
          title={`${sp.module} · ${sp.activity} split`}
          meta={`${sp.ranges.length} band${sp.ranges.length === 1 ? "" : "s"} · ${when(sp.savedAt)}`}
        >
          <table>
            <thead><tr><th>Surnames</th><th>Day</th><th>Time</th><th>Room</th></tr></thead>
            <tbody>
              {sp.ranges.map((r, i) => (
                <tr key={i}>
                  <td className="mono">{r.from}–{r.to}</td><td>{r.day}</td>
                  <td className="mono">{r.start}–{r.end}</td><td>{r.room ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sp.note && <p className="dim" style={{ fontSize: 12, marginTop: 6 }}>{sp.note}</p>}
        </Entry>
      ))}

      {view?.classList && (
        <Entry
          title="Class list"
          meta={`${view.classList.members} students · v${view.classList.version} · ${when(view.classList.savedAt)}`}
        >
          <p className="dim" style={{ fontSize: 12, marginBottom: 6 }}>
            Counts only — names are stored as keys and can&rsquo;t be shown.
          </p>
          <div className="saved-scroll">
            <table>
              <thead><tr><th>Group</th><th>Sub</th><th>Students</th><th>Day</th><th>Workshop</th><th>Drawing</th></tr></thead>
              <tbody>
                {view.classList.groups.map((g, i) => (
                  <tr key={i}>
                    <td>{g.group}</td><td className="mono">{g.subgroup ?? "—"}</td><td>{g.count}</td>
                    <td>{g.day ?? "—"}</td><td className="mono">{g.workshop ?? "—"}</td><td className="mono">{g.drawing ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Entry>
      )}
    </section>
  );
}

function Entry({ title, meta, children }: { title: string; meta: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="saved-entry">
      <button type="button" className="saved-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className={open ? "chev open" : "chev"} aria-hidden="true" />
        <span className="saved-title">{title}</span>
        <span className="dim">{meta}</span>
      </button>
      {open && <div className="saved-body">{children}</div>}
    </div>
  );
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-IE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
