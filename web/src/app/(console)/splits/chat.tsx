"use client";

import { useState, useRef, useEffect } from "react";
import { sendSplitMessage, saveSplit, type Turn, type ChatResult } from "./actions";
import type { SplitRule } from "@/lib/splits/rules";

export function SplitChat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<ChatResult | null>(null);
  const [proposal, setProposal] = useState<SplitRule | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [turns, proposal]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setSaved(null);
    const sent: Turn = { role: "user", text };
    setTurns((t) => [...t, sent]);
    setDraft("");
    try {
      const result = await sendSplitMessage(turns, text);
      setLast(result);
      if (result.reply) setTurns((t) => [...t, { role: "model", text: result.reply! }]);
      if (result.proposal) setProposal(result.proposal);
    } finally {
      setBusy(false);
    }
  }

  async function onSave() {
    if (!proposal) return;
    setBusy(true);
    try {
      const result = await saveSplit(proposal, null);
      if (result.ok) {
        setSaved(`${proposal.moduleKey} ${proposal.activity} saved.`);
        setProposal(null);
      } else {
        setLast({ ok: false, error: result.error });
      }
    } finally {
      setBusy(false);
    }
  }

  const errors = last?.problems?.filter((p) => p.level === "error") ?? [];
  const warnings = last?.problems?.filter((p) => p.level === "warn") ?? [];

  return (
    <>
      <div className="chat">
        {turns.length === 0 && (
          <p className="dim">
            Describe the split in your own words. For example: &ldquo;In EEG1001, surnames A
            to M have the lecture Tuesday at 10, N to Z have it Thursday at 2.&rdquo;
          </p>
        )}
        {turns.map((t, i) => (
          <div key={i} className={t.role === "user" ? "turn mine" : "turn"}>
            {t.text}
          </div>
        ))}
        {busy && <div className="turn dim">Thinking…</div>}
        <div ref={endRef} />
      </div>

      {last?.error && (
        <p className={last.retryable ? "tag warn" : "err"}>
          {last.error}
          {last.retryable && " Send it again."}
        </p>
      )}
      {saved && <p className="tag ok">{saved}</p>}

      {proposal && (
        <div className="proposal">
          <h2>
            {proposal.moduleKey || <span className="tag off">no module</span>}{" "}
            <span className="dim">{proposal.activity}</span>
          </h2>

          <table>
            <thead>
              <tr>
                <th>Surnames</th><th>Day</th><th>Time</th><th>Room</th>
              </tr>
            </thead>
            <tbody>
              {proposal.ranges.map((r, i) => (
                <tr key={i}>
                  <td className="mono">{r.from}–{r.to}</td>
                  <td>{r.day}</td>
                  <td className="mono">{r.start}–{r.end}</td>
                  <td>{r.room ?? <span className="dim">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {errors.map((p, i) => <p key={`e${i}`} className="tag off">{p.message}</p>)}
          {warnings.map((p, i) => <p key={`w${i}`} className="tag warn">{p.message}</p>)}

          <div className="row" style={{ marginTop: 16 }}>
            <button className="primary" onClick={onSave} disabled={busy || errors.length > 0}>
              Save this split
            </button>
            <button onClick={() => setProposal(null)} disabled={busy}>Discard</button>
            {errors.length > 0 && (
              <span className="dim" style={{ fontSize: 12 }}>
                Fix the errors by telling it what&rsquo;s wrong.
              </span>
            )}
          </div>
        </div>
      )}

      <form
        action={() => send(draft)}
        className="row"
        style={{ marginTop: 20 }}
      >
        <div className="field" style={{ flex: 1, marginBottom: 0 }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Describe a split, or answer its question…"
            disabled={busy}
          />
        </div>
        <button type="submit" className="primary" disabled={busy || !draft.trim()}>
          Send
        </button>
      </form>
    </>
  );
}
