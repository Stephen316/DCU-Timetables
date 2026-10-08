"use client";

import { useEffect, useState } from "react";
import { listLibrary, reuseRotation, reuseSplit, type LibraryEntry, type Reused } from "./library";
import { moduleFor, programmeFor } from "@/lib/proposals/courses";
import { Combobox } from "../combobox";
import { Spinner } from "../spinner";

/// Every table saved on any course or module, in one dropdown, so a rotation read while
/// EEG1001 was selected can be opened from EEG1004, or a split copied to a sister module,
/// without uploading or describing it again. Choosing one shows what it covers; using it
/// puts it on the panel as a proposal for the current selection, and nothing is saved until
/// that is accepted.
export function LibraryPanel({ programme, module, refresh, disabled, onReuse }: {
  programme: string; module: string; refresh: number; disabled: boolean;
  onReuse: (r: Extract<Reused, { ok: true }>) => void;
}) {
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [chosen, setChosen] = useState("");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let current = true;
    setLoading(true);
    listLibrary()
      .then((r) => { if (current) { if (r.ok) { setEntries(r.entries); setError(null); } else setError(r.error); } })
      .catch((e) => current && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => current && setLoading(false));
    return () => { current = false; };
  }, [refresh]);

  const sorted = [...(entries ?? [])].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  const entry = sorted.find((e) => keyOf(e) === chosen);

  async function use(run: () => Promise<Reused>) {
    setWorking(true);
    setError(null);
    try {
      const r = await run();
      if (r.ok) onReuse(r);
      else setError(r.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  }

  const scope = { programme, module };

  return (
    <section className="saved" aria-labelledby="library-heading">
      <div className="saved-head">
        <h2 id="library-heading">Reuse a saved table</h2>
        <span className="dim">{entries && `${entries.length} saved, every course and module`}</span>
        {loading && <Spinner />}
      </div>

      {entries && entries.length === 0 ? (
        <p className="dim" style={{ fontSize: 13 }}>Nothing saved yet. A rotation, split or class list appears here once accepted.</p>
      ) : (
        <Combobox
          id="reuse"
          label="Saved table"
          placeholder="Search by module, course, activity or title…"
          value={chosen}
          disabled={disabled || !entries}
          options={sorted.map(option)}
          onChange={(v) => { setChosen(v); setError(null); }}
        />
      )}

      {error && <p className="err">{error}</p>}

      {entry && (
        <div className="saved-entry">
          <div className="saved-body" style={{ borderTop: "none" }}>
            {entry.kind === "rotation" && (() => {
              const same = entry.programme === programme;
              const here = entry.modules.find((m) => m.code === module);
              return (
                <>
                  <h2>
                    Lab rotation <span className="dim">{nameOf(entry.programme)}{entry.title ? ` · ${entry.title}` : ""}</span>
                  </h2>
                  <p className="dim" style={{ fontSize: 12 }}>
                    {entry.total} sessions · v{entry.version} · saved {when(entry.savedAt)}.{" "}
                    {module && (here
                      ? `Covers ${module}: ${here.sessions} session${here.sessions === 1 ? "" : "s"}.`
                      : `Has no sessions for ${module}.`)}
                    {" "}A rotation is one table for the whole course, saved again as a new version.
                  </p>
                  <table>
                    <thead><tr><th>Module</th><th>Title</th><th>Sessions</th><th>Under</th></tr></thead>
                    <tbody>
                      {entry.modules.map((m) => (
                        <tr key={m.code} className={m.code === module ? "on" : undefined}>
                          <td className="mono">{m.code}</td>
                          <td>{moduleFor(m.code)?.title ?? <span className="dim">—</span>}</td>
                          <td>{m.sessions}</td>
                          <td>{m.activities.join(", ") || <span className="dim">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Use
                    label={same ? "Open to correct" : `Copy to ${programme || "?"}`}
                    working={working} disabled={disabled || !programme}
                    onClick={() => use(() => reuseRotation(entry.programme, scope))}
                  />
                </>
              );
            })()}

            {entry.kind === "split" && (() => {
              const same = entry.module === module;
              return (
                <>
                  <h2>
                    {entry.module} · {entry.activity} split{" "}
                    <span className="dim">{moduleFor(entry.module)?.title}</span>
                  </h2>
                  <p className="dim" style={{ fontSize: 12 }}>
                    {entry.programmes.map(nameOf).join(", ") || "No course"} · {entry.ranges.length} band
                    {entry.ranges.length === 1 ? "" : "s"} · saved {when(entry.savedAt)}.
                  </p>
                  <table>
                    <thead><tr><th>Surnames</th><th>Day</th><th>Time</th><th>Room</th></tr></thead>
                    <tbody>
                      {entry.ranges.map((r, i) => (
                        <tr key={i}>
                          <td className="mono">{r.from}–{r.to}</td><td>{r.day}</td>
                          <td className="mono">{r.start}–{r.end}</td><td>{r.room ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {entry.note && <p className="dim" style={{ fontSize: 12, marginTop: 6 }}>{entry.note}</p>}
                  <Use
                    label={!module ? "Pick a module to copy it to" : same ? "Open to correct" : `Copy to ${module}`}
                    working={working} disabled={disabled || !module}
                    onClick={() => use(() => reuseSplit({ module: entry.module, activity: entry.activity }, scope))}
                  />
                </>
              );
            })()}

            {entry.kind === "classList" && (
              <>
                <h2>Class list <span className="dim">{nameOf(entry.programme)}</span></h2>
                <p className="dim" style={{ fontSize: 12 }}>
                  {entry.members} students · {entry.groups} group{entry.groups === 1 ? "" : "s"} · v{entry.version} ·
                  saved {when(entry.savedAt)}.
                </p>
                <p className="dim" style={{ fontSize: 12, margin: 0 }}>
                  Can&rsquo;t be reopened or copied: names are saved only as keys, so there is nothing
                  to put back on the panel. Attach the file again to change it.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Use({ label, working, disabled, onClick }: {
  label: string; working: boolean; disabled: boolean; onClick: () => void;
}) {
  return (
    <div className="row" style={{ marginTop: 12 }}>
      <button type="button" className="primary" disabled={disabled || working} onClick={onClick}>
        {working ? <><Spinner /> Loading…</> : label}
      </button>
    </div>
  );
}

function keyOf(e: LibraryEntry): string {
  return e.kind === "split" ? `split:${e.module}:${e.activity}` : `${e.kind}:${e.programme}`;
}

/// One line in the dropdown: the module or course it belongs to, what it is, and what it
/// covers. Searchable by every code and title it touches, so "EEG1004" finds the rotation
/// that includes it and "maths" finds a split of Engineering Mathematics.
function option(e: LibraryEntry) {
  const course = (key: string) => {
    const p = programmeFor(key);
    return [key, p?.name, ...(p?.covers ?? []).flatMap((c) => [c.code, c.name, c.cao])].join(" ");
  };
  const mod = (code: string) => {
    const m = moduleFor(code);
    return [code, m?.title, m?.aka].filter(Boolean).join(" ");
  };
  if (e.kind === "rotation") {
    return {
      value: keyOf(e), code: e.programme,
      label: `Lab rotation${e.title ? ` — ${e.title}` : ""}`,
      hint: `${e.modules.map((m) => m.code).join(", ")} · ${e.total} sessions · ${when(e.savedAt)}`,
      keywords: ["rotation lab", course(e.programme), ...e.modules.flatMap((m) => [mod(m.code), ...m.activities])].join(" "),
    };
  }
  if (e.kind === "split") {
    return {
      value: keyOf(e), code: e.module,
      label: `${e.activity} split — ${moduleFor(e.module)?.title ?? e.module}`,
      hint: `${e.programmes.join(", ")} · ${e.ranges.length} band${e.ranges.length === 1 ? "" : "s"} · ${when(e.savedAt)}`,
      keywords: ["split", mod(e.module), e.note ?? "", ...e.programmes.map(course)].join(" "),
    };
  }
  return {
    value: keyOf(e), code: e.programme,
    label: `Class list — ${nameOf(e.programme)}`,
    hint: `${e.members} students · ${e.groups} groups · ${when(e.savedAt)}`,
    keywords: ["class list roster", course(e.programme), e.title ?? ""].join(" "),
  };
}

function nameOf(key: string): string {
  return programmeFor(key)?.name ?? key;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-IE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
