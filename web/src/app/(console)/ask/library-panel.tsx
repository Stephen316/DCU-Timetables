"use client";

import { useEffect, useMemo, useState } from "react";
import { listLibrary, reuseRotation, reuseSplit, type LibraryEntry, type Reused } from "./library";
import { moduleFor, programmeFor } from "@/lib/proposals/courses";
import { Spinner } from "../spinner";

/// Every saved table, searchable, with what each covers — so a rotation read once for
/// EEG1001 can be opened again while EEG1004 is selected, or a split copied to a sister
/// module, without uploading or describing it again. Reusing puts it on the panel as a
/// proposal; nothing is saved until that is accepted.
export function LibraryPanel({ programme, module, refresh, disabled, onReuse }: {
  programme: string; module: string; refresh: number; disabled: boolean;
  onReuse: (r: Extract<Reused, { ok: true }>) => void;
}) {
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [working, setWorking] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setLoading(true);
    listLibrary()
      .then((r) => { if (current) { if (r.ok) { setEntries(r.entries); setError(null); } else setError(r.error); } })
      .catch((e) => current && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => current && setLoading(false));
    return () => { current = false; };
  }, [refresh]);

  // What the selection makes relevant goes first; within that, newest first.
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return (entries ?? [])
      .filter((e) => words.every((w) => haystack(e).includes(w)))
      .sort((a, b) => Number(covers(b, programme, module)) - Number(covers(a, programme, module))
        || b.savedAt.localeCompare(a.savedAt));
  }, [entries, query, programme, module]);

  async function reuse(key: string, run: () => Promise<Reused>) {
    setWorking(key);
    setError(null);
    try {
      const r = await run();
      if (r.ok) onReuse(r);
      else setError(r.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(null);
    }
  }

  const scope = { programme, module };
  const relevant = shown.filter((e) => covers(e, programme, module)).length;

  return (
    <section className="saved" aria-labelledby="library-heading">
      <div className="saved-head">
        <h2 id="library-heading">Reuse a saved table</h2>
        <span className="dim">
          {entries && `${shown.length} of ${entries.length}${module && relevant ? ` · ${relevant} cover ${module}` : ""}`}
        </span>
        {loading && <Spinner />}
      </div>

      <div className="field">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by module, course, activity or title…"
          aria-label="Search saved tables"
        />
      </div>

      {error && <p className="err">{error}</p>}
      {entries && entries.length === 0 && (
        <p className="dim" style={{ fontSize: 13 }}>Nothing saved yet. A rotation, split or class list appears here once accepted.</p>
      )}
      {entries && entries.length > 0 && shown.length === 0 && (
        <p className="dim" style={{ fontSize: 13 }}>Nothing matches &ldquo;{query}&rdquo;.</p>
      )}

      {shown.map((e) => {
        if (e.kind === "rotation") {
          const key = `rotation:${e.programme}`;
          const here = e.modules.find((m) => m.code === module);
          const same = e.programme === programme;
          return (
            <Row
              key={key}
              title="Lab rotation"
              meta={`${nameOf(e.programme)}${e.title ? ` · ${e.title}` : ""} · ${e.total} sessions · v${e.version} · ${when(e.savedAt)}`}
              chips={e.modules.map((m) => ({ label: m.code, on: m.code === module }))}
              action={same ? "Open to correct" : `Copy to ${programme || "?"}`}
              working={working === key}
              disabled={disabled || !programme || working !== null}
              onAction={() => reuse(key, () => reuseRotation(e.programme, scope))}
            >
              {module && same && (
                <p className="dim" style={{ fontSize: 12, margin: "8px 0" }}>
                  {here
                    ? `Already applies to ${module}: ${here.sessions} session${here.sessions === 1 ? "" : "s"}. Open it to correct any of them — it is saved again as one rotation for the whole course.`
                    : `Has no sessions for ${module}.`}
                </p>
              )}
              <table>
                <thead><tr><th>Module</th><th>Title</th><th>Sessions</th><th>Under</th></tr></thead>
                <tbody>
                  {e.modules.map((m) => (
                    <tr key={m.code}>
                      <td className="mono">{m.code}</td>
                      <td>{moduleFor(m.code)?.title ?? <span className="dim">—</span>}</td>
                      <td>{m.sessions}</td>
                      <td>{m.activities.join(", ") || <span className="dim">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Row>
          );
        }

        if (e.kind === "split") {
          const key = `split:${e.module}:${e.activity}`;
          const same = e.module === module;
          return (
            <Row
              key={key}
              title={`${e.module} · ${e.activity} split`}
              meta={`${moduleFor(e.module)?.title ?? ""}${e.programmes.length ? ` · ${e.programmes.map(nameOf).join(", ")}` : ""} · ${e.ranges.length} band${e.ranges.length === 1 ? "" : "s"} · ${when(e.savedAt)}`}
              chips={[{ label: e.module, on: same }]}
              action={!module ? "Pick a module to copy to" : same ? "Open to correct" : `Copy to ${module}`}
              working={working === key}
              disabled={disabled || !module || working !== null}
              onAction={() => reuse(key, () => reuseSplit({ module: e.module, activity: e.activity }, scope))}
            >
              <table>
                <thead><tr><th>Surnames</th><th>Day</th><th>Time</th><th>Room</th></tr></thead>
                <tbody>
                  {e.ranges.map((r, i) => (
                    <tr key={i}>
                      <td className="mono">{r.from}–{r.to}</td><td>{r.day}</td>
                      <td className="mono">{r.start}–{r.end}</td><td>{r.room ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {e.note && <p className="dim" style={{ fontSize: 12, marginTop: 6 }}>{e.note}</p>}
            </Row>
          );
        }

        return (
          <Row
            key={`classList:${e.programme}`}
            title="Class list"
            meta={`${nameOf(e.programme)} · ${e.members} students · ${e.groups} group${e.groups === 1 ? "" : "s"} · v${e.version} · ${when(e.savedAt)}`}
            chips={[{ label: e.programme, on: e.programme === programme }]}
          >
            <p className="dim" style={{ fontSize: 12, margin: "8px 0 0" }}>
              Can&rsquo;t be reopened or copied: names are saved only as keys, so there is nothing
              to put back on the panel. Attach the file again to change it.
            </p>
          </Row>
        );
      })}
    </section>
  );
}

function Row({ title, meta, chips, action, working, disabled, onAction, children }: {
  title: string; meta: string; chips: { label: string; on: boolean }[];
  action?: string; working?: boolean; disabled?: boolean; onAction?: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="saved-entry">
      <div className="saved-row">
        <button type="button" className="saved-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className={open ? "chev open" : "chev"} aria-hidden="true" />
          <span className="saved-title">{title}</span>
          <span className="dim">{meta}</span>
        </button>
        {action && (
          <button type="button" className="saved-delete" disabled={disabled} onClick={onAction}>
            {working ? <><Spinner /> Loading…</> : action}
          </button>
        )}
      </div>
      <div className="chips">
        {chips.map((c) => <span key={c.label} className={c.on ? "chip on" : "chip"}>{c.label}</span>)}
      </div>
      {open && <div className="saved-body">{children}</div>}
    </div>
  );
}

/// Whether an entry is about the current selection: a rotation or class list for the
/// programme, a rotation with sessions for the module, a split of the module.
function covers(e: LibraryEntry, programme: string, module: string): boolean {
  if (e.kind === "rotation") return e.programme === programme && (!module || e.modules.some((m) => m.code === module));
  if (e.kind === "split") return !!module && e.module === module;
  return e.programme === programme;
}

/// Everything a search can match: codes, DCU's titles and search words, course names and
/// the codes they cover, activities, and the document's own title.
function haystack(e: LibraryEntry): string {
  const course = (key: string) => {
    const p = programmeFor(key);
    return [key, p?.name, ...(p?.covers ?? []).flatMap((c) => [c.code, c.name, c.cao])].join(" ");
  };
  const mod = (code: string) => {
    const m = moduleFor(code);
    return [code, m?.title, m?.aka].join(" ");
  };
  const parts =
    e.kind === "rotation"
      ? ["rotation lab", course(e.programme), e.title, ...e.modules.flatMap((m) => [mod(m.code), ...m.activities])]
      : e.kind === "split"
        ? ["split", mod(e.module), e.activity, e.note, ...e.programmes.map(course)]
        : ["class list roster", course(e.programme), e.title];
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function nameOf(key: string): string {
  return programmeFor(key)?.name ?? key;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-IE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
