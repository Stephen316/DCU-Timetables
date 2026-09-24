"use client";

import { useState, useRef, useEffect } from "react";
import { ask, accept, type Turn, type AskResult } from "./actions";
import type { Proposal } from "@/lib/proposals/types";
import { PROGRAMMES, modulesFor } from "@/lib/proposals/courses";
import { Combobox } from "../combobox";
import { csvField, ROSTER_HEADER } from "@/lib/roster/parse";
import { MAX_UPLOAD_BYTES, formatBytes } from "@/lib/upload";
import { Spinner } from "../spinner";
import { SavedPanel } from "./saved-panel";
import { describeChange, weekday } from "@/lib/changes/change";

/// What the transcript shows. The attachment and proposal number are display only — the
/// history sent back to the model is the words, as before.
type Shown = Turn & { attachment?: { name: string; size: number }; proposalNos?: number[] };

/// Every proposal made in this conversation, kept until it is saved or thrown away. A
/// follow-up question used to replace the proposal on the panel, so answering one lost the
/// last — now each stays, numbered, and can be accepted on its own.
type Item = {
  no: number;
  proposal: Proposal;
  /// A class list or rotation and its corrections share this: the number of the proposal
  /// the upload made. Accepting any one of them ends the conversation about it.
  doc?: number;
  /// The version this one corrects.
  basedOn?: number;
  status: "open" | "saving" | "saved";
  message?: string;
  error?: string;
};

/// What saving a proposal overwrites. Two proposals with the same target replace each
/// other, so whichever is accepted last is what is kept.
function target(p: Proposal): string {
  if (p.kind === "split") return `split ${p.rule.moduleKey} ${p.rule.activity}`;
  // Changes add up rather than replace; only an identical one is "the same thing".
  if (p.kind === "change") return `change ${JSON.stringify(p.change)}`;
  return `${p.kind} ${p.courseKey}`;
}

function describe(p: Proposal): string {
  if (p.kind === "split") return `${p.rule.moduleKey || "?"} ${p.rule.activity} split`;
  if (p.kind === "roster") return `${p.courseKey || "?"} class list · ${p.rows.length} students`;
  if (p.kind === "change") return describeChange(p.change);
  return `${p.courseKey || "?"} rotation · ${p.sessions.filter((s) => s.groups?.length).length} sessions`;
}

function blocking(p: Proposal): boolean {
  return (p.kind === "split" ? p.problems : p.findings).some((f) => f.level === "error");
}

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.docx,.csv,.tsv,.txt,.md";

export function Ask() {
  const [programme, setProgramme] = useState(PROGRAMMES[0]?.key ?? "");
  const [moduleKey, setModuleKey] = useState("");
  const [turns, setTurns] = useState<Shown[]>([]);
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  // What is being waited on, and since when — drives the progress line in the transcript.
  const [pending, setPending] = useState<{ label: string; since: number } | null>(null);
  const [now, setNow] = useState(0);
  const [last, setLast] = useState<AskResult | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  // Said once, when accepting a document starts the conversation again.
  const [notice, setNotice] = useState<string | null>(null);
  // The newest unsaved version of a class list or rotation, if there is one.
  const activeDoc = [...items].reverse().find((i) => i.doc && i.status !== "saved");
  // Bumped after every save, so the Saved list under the chat reads the database again.
  const [refresh, setRefresh] = useState(0);
  // Proposal numbers only go up. Derived from the list, a discarded #3 would hand its number
  // to the next proposal, and "Proposal 3" in the transcript would point at the wrong one.
  const counter = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [turns, busy]);

  // A one-second tick while something is pending, so the wait shows as time passing rather
  // than as a page that might have stopped.
  useEffect(() => {
    if (!pending) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [pending]);

  /// Checked the moment a file is picked or dropped, not after it has been sent: an
  /// oversized file used to fail inside the request, and the only sign was a Send button
  /// that seemed to do nothing.
  function choose(next: File | null) {
    setFileError(null);
    if (fileInput.current) fileInput.current.value = "";
    if (!next) { setFile(null); return; }
    if (next.size > MAX_UPLOAD_BYTES) {
      setFile(null);
      setFileError(`${next.name} is ${formatBytes(next.size)} — the limit is ${formatBytes(MAX_UPLOAD_BYTES)}. ` +
        `Export a smaller PDF, or photograph one page at a time.`);
      return;
    }
    const ext = next.name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
    if (!ACCEPT.split(",").includes(ext)) {
      setFile(null);
      setFileError(`${next.name} can't be read. PDF, photo, .xlsx, .docx, CSV or text.`);
      return;
    }
    setFile(next);
  }

  async function send() {
    if ((!draft.trim() && !file) || busy) return;
    const text = draft.trim();
    const sending = file;
    // Until it is accepted, a class list or rotation on the panel is what every message is
    // about. A new file starts on a new document instead.
    const correcting = sending ? undefined : activeDoc;
    setBusy(true);
    setLast(null);
    setNotice(null);
    setPending({
      label: sending ? `Reading ${sending.name}` : correcting ? `Correcting proposal ${correcting.no}` : "Thinking",
      since: Date.now(),
    });

    const historyBefore: Turn[] = turns.map(({ role, text }) => ({ role, text }));
    setTurns((t) => [...t, {
      role: "user",
      text: text || `Attached ${sending!.name}`,
      attachment: sending ? { name: sending.name, size: sending.size } : undefined,
    }]);

    const form = new FormData();
    form.set("message", text);
    form.set("programme", programme);
    form.set("module", moduleKey);
    form.set("history", JSON.stringify(historyBefore));
    if (sending) form.set("file", sending);
    if (correcting) form.set("document", JSON.stringify(correcting.proposal));
    setDraft("");
    choose(null);

    try {
      const result = await ask(form);
      setLast(result);
      // A message can ask for several changes at once; each is its own proposal.
      const made = result.proposals ?? (result.proposal ? [result.proposal] : []);
      const fresh: Item[] = made.map((proposal) => {
        const no = ++counter.current;
        const isDoc = proposal.kind === "roster" || proposal.kind === "rotation";
        return { no, proposal, status: "open", doc: isDoc ? (correcting?.doc ?? no) : undefined, basedOn: correcting?.no };
      });
      if (fresh.length) setItems((all) => [...all, ...fresh]);
      if (result.reply || fresh.length) {
        setTurns((t) => [...t, { role: "model", text: result.reply ?? "", proposalNos: fresh.map((f) => f.no) }]);
      }
    } catch (e) {
      // The request itself failed — the connection, or the platform refusing it. Put the
      // message and the file back, so trying again is one click rather than starting over.
      setTurns((t) => t.slice(0, -1));
      setDraft(text);
      if (sending) setFile(sending);
      setLast({
        ok: false,
        retryable: true,
        error: `Couldn't send${e instanceof Error && e.message ? ` (${e.message})` : ""}.`,
      });
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  /// Starts over without leaving the page. Every turn resends the whole history, so this
  /// trims cost slightly — but the real reason is that turns about one module are still in
  /// front of the model when you start asking about another.
  ///
  /// Unsaved proposals are the one thing worth guarding: each cost a model request, and a
  /// stray click should not throw them away.
  function reset() {
    const open = items.filter((i) => i.status !== "saved").length;
    if (open && !window.confirm(`Discard ${open} unsaved proposal${open === 1 ? "" : "s"}? They have not been saved.`)) return;
    setTurns([]);
    setItems([]);
    counter.current = 0;
    setLast(null);
    setNotice(null);
    setDraft("");
    choose(null);
  }

  function update(no: number, change: Partial<Item>) {
    setItems((all) => all.map((i) => (i.no === no ? { ...i, ...change } : i)));
  }

  function discard(no: number) {
    setItems((all) => all.filter((i) => i.no !== no));
  }

  async function onAccept(item: Item) {
    const proposal = item.proposal;
    update(item.no, { status: "saving", error: undefined });
    try {
      const result = await accept(proposal);
      if (result.ok) {
        update(item.no, {
          status: "saved",
          message: proposal.kind === "split"
            ? `${proposal.rule.moduleKey} ${proposal.rule.activity} saved.`
            : proposal.kind === "change"
              ? "Change saved. Phones pick it up when the app next opens."
            : proposal.kind === "roster"
              ? `Class list saved — ${proposal.rows.length} students. Phones re-check on their next launch.`
              : `Rotation saved — ${proposal.sessions.filter((s) => s.groups?.length).length} sessions.`,
        });
        setRefresh((r) => r + 1);
        // A document is settled once one version of it is saved: the other versions go,
        // and so does the conversation about it — the next message starts fresh.
        if (item.doc) {
          setItems((all) => all.filter((i) => i.no === item.no || i.doc !== item.doc || i.status === "saved"));
          setTurns([]);
          setLast(null);
          setNotice(`Proposal ${item.no} saved. This is a new conversation.`);
        }
      } else {
        update(item.no, { status: "open", error: result.error });
      }
    } catch (e) {
      update(item.no, { status: "open", error: `Couldn't save${e instanceof Error && e.message ? ` (${e.message})` : ""}. Try again.` });
    }
  }

  const unsaved = items.filter((i) => i.status !== "saved").length;

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
          {notice && turns.length === 0 && <p className="tag ok">{notice}</p>}
          {turns.length === 0 && (
            <p className="dim">
              Describe a change, or attach a document. For example: &ldquo;In EEG1001,
              surnames A to M have the lecture Tuesday at 10, N to Z Thursday at 2&rdquo; —
              or attach a document — a lab rotation or a class list, as a PDF, photo,
              spreadsheet, Word file or CSV.
            </p>
          )}
          {turns.map((t, i) => (
            <div key={i} className={t.role === "user" ? "turn mine" : "turn"}>
              {t.attachment && (
                <div className="turn-file">
                  <span className="mono">{t.attachment.name}</span>
                  <span className="dim"> · {formatBytes(t.attachment.size)}</span>
                </div>
              )}
              {!(t.attachment && t.text === `Attached ${t.attachment.name}`) && t.text}
              {!!t.proposalNos?.length && (
                <div className="turn-ref">
                  Proposal{t.proposalNos.length > 1 ? "s" : ""} {t.proposalNos.join(", ")} {t.proposalNos.length > 1 ? "are" : "is"} on the panel →
                </div>
              )}
            </div>
          ))}
          {pending && (
            <div className="turn pending" role="status" aria-live="polite">
              <Spinner />
              <span>{pending.label}…</span>
              <span className="dim mono">{Math.max(0, Math.floor((now - pending.since) / 1000))}s</span>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {last?.error && (
          <p className={last.retryable ? "tag warn" : "err"}>
            {last.error}{last.retryable && " Send it again."}
          </p>
        )}

        {/* onSubmit, not `action={send}`. A form action runs inside a React transition, and
            React holds a transition's state updates until the whole async action finishes —
            so the sent message, the busy state and the progress line all stayed invisible
            until the model replied, and Send looked dead for the length of the request. */}
        <form
          onSubmit={(e) => { e.preventDefault(); void send(); }}
          className={dragging ? "composer dragging" : "composer"}
          onDragOver={(e) => { e.preventDefault(); if (!busy) setDragging(true); }}
          onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!busy) choose(e.dataTransfer.files?.[0] ?? null);
          }}
        >
          {(file || fileError) && (
            <div className={fileError ? "attach-chip bad" : "attach-chip"}>
              {file ? (
                <>
                  <span className="mono">{file.name}</span>
                  <span className="dim">{formatBytes(file.size)} · ready to send</span>
                  <button type="button" className="link" onClick={() => choose(null)} disabled={busy}
                    aria-label={`Remove ${file.name}`}>Remove</button>
                </>
              ) : (
                <span>{fileError}</span>
              )}
            </div>
          )}
          {activeDoc && !file && (
            <p className="correcting">
              Messages now correct proposal {activeDoc.no} until you accept it — for example
              &ldquo;row 58 is a heading, not a student&rdquo; or &ldquo;row 12 is group B&rdquo;.
              Attaching a file starts on a new document.
            </p>
          )}
          <div className="row">
            <div className="field" style={{ flex: 1, marginBottom: 0 }}>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={file ? "Add a note, or just send the file…"
                  : activeDoc ? `Correct proposal ${activeDoc.no}, or ask about it…`
                  : "Describe a change, or answer its question…"}
                disabled={busy}
              />
            </div>
            <button type="submit" className="primary send" disabled={busy || (!draft.trim() && !file)}>
              {busy && pending ? <><Spinner /> Sending</> : "Send"}
            </button>
          </div>
          <div className="row" style={{ marginTop: 8, alignItems: "center" }}>
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPT}
              onChange={(e) => choose(e.target.files?.[0] ?? null)}
              disabled={busy}
              hidden
            />
            <button type="button" onClick={() => fileInput.current?.click()} disabled={busy}>
              {file ? "Change file" : "Attach file"}
            </button>
            <span className="dim" style={{ fontSize: 12, flex: 1 }}>
              or drop one here · PDF, photo, .xlsx, .docx, CSV · up to {formatBytes(MAX_UPLOAD_BYTES)}
            </span>
            <button
              type="button"
              onClick={reset}
              disabled={busy || (turns.length === 0 && items.length === 0 && !last)}
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

        <SavedPanel programme={programme} module={moduleKey} refresh={refresh} />
      </div>

      <div className="ask-panel">
        {items.length === 0 ? (
          <p className="dim">Nothing proposed yet. Anything it suggests appears here first.</p>
        ) : (
          <>
            <div className="panel-head">
              <h2>Proposals</h2>
              <span className="dim">{unsaved ? `${unsaved} unsaved` : "all saved"}</span>
            </div>
            {[...items].reverse().map((item) => (
              <ProposalCard
                key={item.no}
                item={item}
                others={items.filter((o) => o.no !== item.no && target(o.proposal) === target(item.proposal))}
                onAccept={() => onAccept(item)}
                onDiscard={() => discard(item.no)}
                disabled={busy}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/// One proposal. Open ones start expanded; a saved one folds away but stays, so the
/// conversation keeps its record of what was accepted.
function ProposalCard({ item, others, onAccept, onDiscard, disabled }: {
  item: Item; others: Item[]; onAccept: () => void; onDiscard: () => void; disabled: boolean;
}) {
  const [open, setOpen] = useState(item.status !== "saved");
  useEffect(() => { if (item.status === "saved") setOpen(false); }, [item.status]);
  const p = item.proposal;
  const blocked = blocking(p);
  const savedTwin = others.find((o) => o.status === "saved");
  const openTwins = others.filter((o) => o.status !== "saved");

  return (
    <div className={`proposal-card ${item.status}`}>
      <button type="button" className="saved-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className={open ? "chev open" : "chev"} aria-hidden="true" />
        <span className="saved-title">Proposal {item.no}</span>
        <span className="dim">{describe(p)}{item.basedOn ? ` · corrects ${item.basedOn}` : ""}</span>
        <span className={item.status === "saved" ? "tag ok" : blocked ? "tag off" : "tag warn"} style={{ marginLeft: "auto" }}>
          {item.status === "saved" ? "saved" : item.status === "saving" ? "saving…" : blocked ? "needs fixing" : "unsaved"}
        </span>
      </button>

      {open && (
        <div className="saved-body">
          {p.kind === "split" ? <SplitPanel p={p} />
            : p.kind === "roster" ? <RosterPanel p={p} />
            : p.kind === "change" ? <ChangePanel p={p} />
            : <RotationPanel p={p} />}

          {item.status !== "saved" && savedTwin && (
            <p className="tag warn">Proposal {savedTwin.no} saved the same thing. Accepting this replaces it.</p>
          )}
          {item.status !== "saved" && !savedTwin && openTwins.length > 0 && (
            <p className="tag warn">
              Proposal{openTwins.length > 1 ? "s" : ""} {openTwins.map((o) => o.no).join(", ")} {openTwins.length > 1 ? "are" : "is"} for
              the same thing. Whichever you accept last is what&rsquo;s kept.
            </p>
          )}
          {item.error && <p className="err">{item.error}</p>}

          {item.status === "saved" ? (
            <p className="tag ok">{item.message}</p>
          ) : (
            <>
              <div className="row" style={{ marginTop: 12 }}>
                <button className="primary" onClick={onAccept} disabled={disabled || blocked || item.status === "saving"}>
                  {item.status === "saving" ? <><Spinner /> Saving</> : "Accept and save"}
                </button>
                <button onClick={onDiscard} disabled={item.status === "saving"}>Discard</button>
              </div>
              {blocked && (
                <p className="dim" style={{ fontSize: 12, marginTop: 8 }}>
                  Tell it what&rsquo;s wrong and it will propose again.
                </p>
              )}
            </>
          )}
        </div>
      )}
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

function ChangePanel({ p }: { p: Extract<Proposal, { kind: "change" }> }) {
  const c = p.change;
  return (
    <>
      <h2>
        {c.kind === "remove" ? "Remove" : "Add"} {c.module}{" "}
        <span className="dim">for {c.group ? `group ${c.group}` : "everyone on " + c.courseKey}</span>
      </h2>
      <table>
        <tbody>
          <tr><th>{c.kind === "remove" ? "Class" : "What"}</th>
            <td>{c.kind === "remove" ? <span className="mono">{c.activityCode ?? `every ${c.module} class`}</span> : c.title}</td></tr>
          <tr><th>Time</th><td className="mono">{c.start}{c.end ? `–${c.end}` : ""}</td></tr>
          {c.room && <tr><th>Room</th><td className="mono">{c.room}</td></tr>}
          <tr><th>Dates</th><td>{c.dates.map((d) => `${weekday(d)} ${d}`).join(", ")}</td></tr>
          {c.note && <tr><th>Note</th><td>{c.note}</td></tr>}
        </tbody>
      </table>
      {p.findings.map((f, i) => (
        <p key={i} className={f.level === "error" ? "tag off" : f.level === "warn" ? "tag warn" : "tag ok"}>{f.message}</p>
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
      <div style={{ maxHeight: 380, overflow: "auto", marginTop: 12 }}>
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
      <div style={{ maxHeight: 380, overflow: "auto", marginTop: 12 }}>
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
