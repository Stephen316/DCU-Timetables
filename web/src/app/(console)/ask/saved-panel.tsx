"use client";

import { useEffect, useState } from "react";
import { deleteSaved, listSaved, type SavedTarget, type SavedView } from "./saved";
import { moduleFor, programmeFor } from "@/lib/proposals/courses";
import { Spinner } from "../spinner";

/// What applies to the selected course and module, under the chat: the course's rotation if
/// it has sessions for the module, the module's splits, and the course's class list. Nothing
/// until a module is picked — tables for anything else are offered under "Reuse a saved
/// table" instead. Each entry opens to show what was saved — the thing a new proposal
/// would replace.
export function SavedPanel({ programme, module, refresh }: { programme: string; module: string; refresh: number }) {
  const [view, setView] = useState<SavedView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let current = true;
    if (!module) { setView(null); setError(null); return; }
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
  }, [programme, module, refresh, reload]);

  async function remove(key: string, target: SavedTarget, question: string) {
    if (!window.confirm(question)) return;
    setDeleting(key);
    setError(null);
    try {
      const r = await deleteSaved(target);
      if (!r.ok) setError(r.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(null);
      setReload((n) => n + 1);
    }
  }

  const programmeName = programmeFor(programme)?.name ?? programme;
  const scope = module ? `${programmeName} · ${module}${moduleFor(module) ? ` · ${moduleFor(module)!.title}` : ""}` : programmeName;
  // A rotation with no sessions for the module does not apply to it.
  const rotation = view?.rotation?.sessions.length ? view.rotation : null;
  const empty = view && !rotation && view.splits.length === 0 && !view.classList;

  return (
    <section className="saved" aria-labelledby="saved-heading">
      <div className="saved-head">
        <h2 id="saved-heading">Saved</h2>
        <span className="dim">{scope}</span>
        {loading && <Spinner />}
      </div>

      {error && <p className="err">{error}</p>}
      {!module && (
        <p className="dim" style={{ fontSize: 13 }}>Pick a module to see what is saved for it.</p>
      )}
      {module && empty && !loading && (
        <p className="dim" style={{ fontSize: 13 }}>
          Nothing saved for {module} yet. A table saved for another module can be used here
          from &ldquo;Reuse a saved table&rdquo;.
        </p>
      )}

      {module && rotation && (
        <Entry
          title="Lab rotation"
          meta={`${rotation.sessions.length} of ${rotation.total} sessions · v${rotation.version} · ${when(rotation.savedAt)}`}
          deleting={deleting === "rotation"}
          onDelete={() => remove("rotation", { kind: "rotation", programme },
            `Delete the lab rotation for ${programmeName}? All ${rotation.total} sessions go, across every module — not only ${module}. This can't be undone.`)}
        >
          <div className="saved-scroll">
            <table>
              <thead><tr><th>Wk</th><th>Date</th><th>Day</th><th>Time</th><th>Module</th><th>Activity</th><th>Groups</th></tr></thead>
              <tbody>
                {rotation.sessions.map((s, i) => (
                  <tr key={i}>
                    <td>{s.week ?? "—"}</td><td className="mono">{s.date ?? "—"}</td><td>{s.day ?? "—"}</td>
                    <td className="mono">{s.start && s.end ? `${s.start}–${s.end}` : "—"}</td>
                    <td className="mono">{s.module ?? "—"}</td><td>{s.activity ?? "—"}</td><td>{s.groups.join(" ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Entry>
      )}

      {module && view?.splits.map((sp) => (
        <Entry
          key={`${sp.module}-${sp.activity}`}
          title={`${sp.module} · ${sp.activity} split`}
          meta={`${sp.ranges.length} band${sp.ranges.length === 1 ? "" : "s"} · ${when(sp.savedAt)}`}
          deleting={deleting === `split:${sp.module}:${sp.activity}`}
          onDelete={() => remove(`split:${sp.module}:${sp.activity}`, { kind: "split", module: sp.module, activity: sp.activity },
            `Delete the ${sp.module} ${sp.activity} split? Students stop seeing which band they are in. This can't be undone.`)}
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

      {module && view?.classList && (
        <Entry
          title="Class list"
          meta={`${view.classList.members} students · v${view.classList.version} · ${when(view.classList.savedAt)}`}
          deleting={deleting === "classList"}
          onDelete={() => remove("classList", { kind: "classList", programme },
            `Delete the class list for ${programmeName}? All ${view.classList!.members} students lose their group, and phones set up from it go back to the profile screen on their next launch. This can't be undone.`)}
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

function Entry({ title, meta, deleting, onDelete, children }: {
  title: string; meta: string; deleting: boolean; onDelete: () => void; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="saved-entry">
      {/* Side by side, not nested: a button inside the toggle would be a button in a button. */}
      <div className="saved-row">
        <button type="button" className="saved-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className={open ? "chev open" : "chev"} aria-hidden="true" />
          <span className="saved-title">{title}</span>
          <span className="dim">{meta}</span>
        </button>
        <button type="button" className="danger saved-delete" disabled={deleting} onClick={onDelete}
                aria-label={`Delete ${title}`}>
          {deleting ? <><Spinner /> Deleting…</> : "Delete"}
        </button>
      </div>
      {open && <div className="saved-body">{children}</div>}
    </div>
  );
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-IE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
