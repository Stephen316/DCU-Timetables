"use client";

import { useState, useRef, useEffect } from "react";
import { ask, accept, type Turn, type AskResult } from "./actions";
import type { Proposal } from "@/lib/proposals/types";
import { PROGRAMMES, modulesFor } from "@/lib/proposals/courses";
import { Combobox } from "../combobox";
import { csvField, ROSTER_HEADER } from "@/lib/roster/parse";

export function Ask() {
  const [programme, setProgramme] = useState(PROGRAMMES[0]?.key ?? "");
  const [moduleKey, setModuleKey] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<AskResult | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [turns, busy]);

  async function send() {
    if ((!draft.trim() && !file) || busy) return;
    setBusy(true);
    setSaved(null);

    const shown = draft.trim() || `Attached ${file!.name}`;
    const historyBefore = turns;
    setTurns((t) => [...t, { role: "user", text: shown }]);

    const form = new FormData();
    form.set("message", draft.trim());
    form.set("programme", programme);
    form.set("module", moduleKey);
    form.set("history", JSON.stringify(historyBefore));
    if (file) form.set("file", file);
    setDraft("");
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";

    try {
      const result = await ask(form);
      setLast(result);
      if (result.reply) setTurns((t) => [...t, { role: "model", text: result.reply! }]);
      if (result.proposal) setProposal(result.proposal);
    } finally {
      setBusy(false);
    }
  }

  /// Starts over without leaving the page. Every turn resends the whole history, so this
  /// trims cost slightly — but the real reason is that turns about one module are still in
  /// front of the model when you start asking about another.
  ///
  /// An unsaved proposal is the one thing worth guarding. A rotation on the panel cost a
  /// request from a daily budget of twenty, and a stray click should not throw it away.
  function reset() {
    if (proposal && !window.confirm("Discard the proposal on the panel? It has not been saved.")) return;
    setTurns([]);
    setProposal(null);
    setLast(null);
    setSaved(null);
    setDraft("");
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function onAccept() {
    if (!proposal) return;
    setBusy(true);
    try {
      const result = await accept(proposal);
      if (result.ok) {
        setSaved(proposal.kind === "split"
          ? `${proposal.rule.moduleKey} ${proposal.rule.activity} saved.`
          : proposal.kind === "roster"
            ? `${proposal.courseKey} class list saved — ${proposal.rows.length} students. Phones re-check on their next launch.`
            : `${proposal.courseKey} rotation saved — ${proposal.sessions.filter((s) => s.groups?.length).length} sessions.`);
        setProposal(null);
      } else {
        setLast({ ok: false, error: result.error });
      }
    } finally {
      setBusy(false);
    }
  }

  const blocked = proposal
    ? (proposal.kind === "split" ? proposal.problems : proposal.findings).some((f) => f.level === "error")
    : false;

  return (
    <div className="ask">
      <div className="ask-chat">
        <div className="row" style={{ marginBottom: 12, alignItems: "flex-start" }}>
          <Combobox
            id="programme"
            label="Programme"
            placeholder="Search programmes…"
            value={programme}
            disabled={busy}
            options={PROGRAMMES.map((p) => ({
              value: p.key,
              label: p.name,
              hint: p.covers.map((c) => c.code).join(", "),
              keywords: p.covers.map((c) => c.name).join(" "),
            }))}
            onChange={(key) => {
              setProgramme(key);
              // A module from the old programme is not a module of the new one. Clearing
              // beats carrying a selection that the scope check would reject later.
              if (!modulesFor(key).some((m) => m.code === moduleKey)) setModuleKey("");
            }}
          />
          <Combobox
            id="module"
            label="Module"
            placeholder="Search by code or name…"
            value={moduleKey}
            disabled={busy}
            options={modulesFor(programme).map((m) => ({
              value: m.code,
              label: m.title,
              hint: `Semester ${m.semester}`,
              keywords: m.aka,
            }))}
            onChange={setModuleKey}
          />
        </div>

        <div className="chat">
          {turns.length === 0 && (
            <p className="dim">
              Describe a change, or attach a document. For example: &ldquo;In EEG1001,
              surnames A to M have the lecture Tuesday at 10, N to Z Thursday at 2&rdquo; —
              or attach a document — a lab rotation or a class list, as a PDF, photo,
              spreadsheet, Word file or CSV.
            </p>
          )}
          {turns.map((t, i) => (
            <div key={i} className={t.role === "user" ? "turn mine" : "turn"}>{t.text}</div>
          ))}
          {busy && <div className="turn dim">Thinking…</div>}
          <div ref={endRef} />
        </div>

        {last?.error && (
          <p className={last.retryable ? "tag warn" : "err"}>
            {last.error}{last.retryable && " Send it again."}
          </p>
        )}
        {saved && <p className="tag ok">{saved}</p>}

        <form action={send} style={{ marginTop: 12 }}>
          <div className="row">
            <div className="field" style={{ flex: 1, marginBottom: 0 }}>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Describe a change, or answer its question…"
                disabled={busy}
              />
            </div>
            <button type="submit" className="primary" disabled={busy || (!draft.trim() && !file)}>
              Send
            </button>
          </div>
          <div className="row" style={{ marginTop: 8, alignItems: "center" }}>
            <input
              ref={fileInput}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.docx,.csv,.tsv,.txt,.md"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={busy}
              style={{ flex: 1 }}
            />
            <button
              type="button"
              onClick={reset}
              disabled={busy || (turns.length === 0 && !proposal && !last)}
            >
              New conversation
            </button>
          </div>
        </form>

        {last?.meta && (
          <p className="dim" style={{ fontSize: 12, marginTop: 10 }}>
            {(last.meta.ms / 1000).toFixed(1)}s
            {last.meta.inputTokens !== undefined &&
              ` · ${last.meta.inputTokens} in / ${last.meta.outputTokens} out`}
          </p>
        )}
      </div>

      <div className="ask-panel">
        {!proposal ? (
          <p className="dim">Nothing proposed yet. Anything it suggests appears here first.</p>
        ) : (
          <>
            {proposal.kind === "split" ? <SplitPanel p={proposal} />
              : proposal.kind === "roster" ? <RosterPanel p={proposal} />
              : <RotationPanel p={proposal} />}
            <div className="row" style={{ marginTop: 16 }}>
              <button className="primary" onClick={onAccept} disabled={busy || blocked}>
                Accept and save
              </button>
              <button onClick={() => setProposal(null)} disabled={busy}>Discard</button>
            </div>
            {blocked && (
              <p className="dim" style={{ fontSize: 12, marginTop: 8 }}>
                Tell it what&rsquo;s wrong and it will propose again.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SplitPanel({ p }: { p: Extract<Proposal, { kind: "split" }> }) {
  return (
    <>
      <h2>
        {p.rule.moduleKey || <span className="tag off">no module</span>}{" "}
        <span className="dim">{p.rule.activity}</span>
      </h2>
      <table>
        <thead><tr><th>Surnames</th><th>Day</th><th>Time</th><th>Room</th></tr></thead>
        <tbody>
          {p.rule.ranges.map((r, i) => (
            <tr key={i}>
              <td className="mono">{r.from}–{r.to}</td>
              <td>{r.day}</td>
              <td className="mono">{r.start}–{r.end}</td>
              <td>{r.room ?? <span className="dim">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {p.problems.map((x, i) => (
        <p key={i} className={x.level === "error" ? "tag off" : "tag warn"}>{x.message}</p>
      ))}
    </>
  );
}

function RotationPanel({ p }: { p: Extract<Proposal, { kind: "rotation" }> }) {
  return (
    <>
      <h2>
        {p.courseKey || <span className="tag off">no course</span>}{" "}
        <span className="dim">
          {p.sessions.filter((s) => s.groups?.length).length} sessions
          {p.sessions.some((s) => !s.groups?.length) &&
            ` · ${p.sessions.filter((s) => !s.groups?.length).length} with no groups, not saved`}
        </span>
      </h2>
      {p.findings.map((f, i) => (
        <p key={i} className={f.level === "error" ? "tag off" : f.level === "warn" ? "tag warn" : "tag ok"}>
          {f.row ? `Row ${f.row}: ` : ""}{f.message}
        </p>
      ))}
      <div style={{ maxHeight: 380, overflowY: "auto", marginTop: 12 }}>
        <table>
          <thead>
            <tr><th>Wk</th><th>Date</th><th>Day</th><th>Time</th><th>Module</th><th>Activity</th><th>Groups</th></tr>
          </thead>
          <tbody>
            {p.sessions.map((s, i) => (
              <tr key={i}>
                <Cell v={s.week} /><Cell v={s.date} mono /><Cell v={s.day} />
                <Cell v={s.start && s.end ? `${s.start}–${s.end}` : null} mono />
                <Cell v={s.module} mono /><Cell v={s.activity} /><Cell v={s.groups?.join(" ")} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/// Names are shown here, to the administrator, and nowhere else: what is saved is each name
/// reduced to a key, and what a phone downloads has no names at all.
function RosterPanel({ p }: { p: Extract<Proposal, { kind: "roster" }> }) {
  const has = (f: "studentId" | "subgroup" | "day" | "workshop" | "drawing") => p.rows.some((r) => r[f]);
  return (
    <>
      <h2>
        {p.courseKey || <span className="tag off">no programme</span>}{" "}
        <span className="dim">class list · {p.rows.length} students · {p.fileName} · {p.readBy}</span>
      </h2>
      <div className="row" style={{ margin: "8px 0" }}>
        <button type="button" onClick={() => downloadCsv(p)}>Download as CSV</button>
      </div>
      {p.findings.map((f, i) => (
        <p key={i} className={f.level === "error" ? "tag off" : f.level === "warn" ? "tag warn" : "tag ok"}>
          {f.row ? `Row ${f.row}: ` : ""}{f.message}
        </p>
      ))}
      <div style={{ maxHeight: 380, overflowY: "auto", marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              <th>Row</th><th>Surname</th><th>First name</th>
              {has("studentId") && <th>ID</th>}
              <th>Group</th>
              {has("subgroup") && <th>Sub</th>}
              {has("day") && <th>Day</th>}
              {has("workshop") && <th>Workshop</th>}
              {has("drawing") && <th>Drawing</th>}
            </tr>
          </thead>
          <tbody>
            {p.rows.map((r) => (
              <tr key={r.row}>
                <td className="mono dim">{r.row}</td>
                <td>{r.surname ?? <span className="dim">—</span>}</td>
                <td>{r.given ?? <span className="dim">—</span>}</td>
                {has("studentId") && <td className="mono">{r.studentId ?? <span className="dim">—</span>}</td>}
                <Cell v={r.group} />
                {has("subgroup") && <td className="mono">{r.subgroup ?? <span className="dim">—</span>}</td>}
                {has("day") && <td>{r.day ?? <span className="dim">—</span>}</td>}
                {has("workshop") && <td className="mono">{r.workshop ?? <span className="dim">—</span>}</td>}
                {has("drawing") && <td className="mono">{r.drawing ?? <span className="dim">—</span>}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/// The class list exactly as it will be saved, as CSV — the normalised form of whatever
/// was uploaded. Built in the browser from the rows on the panel, so it is the same data.
function downloadCsv(p: Extract<Proposal, { kind: "roster" }>) {
  const lines = [ROSTER_HEADER, ...p.rows.map((r) =>
    [r.surname, r.given, r.studentId, r.group, r.subgroup, r.day, r.workshop, r.drawing].map(csvField).join(","))];
  const url = URL.createObjectURL(new Blob([lines.join("\n") + "\n"], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${p.courseKey || "class-list"}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/// A null is the model saying it could not read the cell, which is a different thing from an
/// empty one and has to look different — it is the row you have to check by eye.
function Cell({ v, mono }: { v: string | number | null | undefined; mono?: boolean }) {
  if (v === null || v === undefined || v === "") return <td className="tag warn">?</td>;
  return <td className={mono ? "mono" : undefined}>{v}</td>;
}
