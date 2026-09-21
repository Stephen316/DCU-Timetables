"use client";

import { useState, useTransition } from "react";
import { findByPI, setRole } from "../actions";

type Found = { id: string; pi: string; role: string; created_at: string };

/// Trust is granted by the ID the student hands you, not by searching names — so you
/// never browse a roster to find a friend, and the disclosure is theirs to make.
export function GrantTrust() {
  const [pi, setPi] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  function look(e: React.FormEvent) {
    e.preventDefault();
    setDone(false);
    start(async () => {
      const result = await findByPI(pi);
      setError(result.error ?? null);
      setFound((result.profile as Found) ?? null);
    });
  }

  function grant() {
    if (!found) return;
    start(async () => {
      const result = await setRole(found.id, "trusted");
      setError(result.error ?? null);
      if (!result.error) {
        setDone(true);
        setFound(null);
        setPi("");
      }
    });
  }

  return (
    <section style={{ marginBottom: 28, paddingBottom: 20, borderBottom: "1px solid var(--border)" }}>
      <h2>Grant trust</h2>
      <form onSubmit={look} className="row" style={{ maxWidth: 420 }}>
        <div style={{ flex: 1 }}>
          <label htmlFor="pi">Their ID</label>
          <input id="pi" className="mono" placeholder="K482913" value={pi}
                 onChange={(e) => setPi(e.target.value)} />
        </div>
        <button type="submit" disabled={pending || pi.trim().length < 7}>Find</button>
      </form>

      {found && (
        <div style={{ marginTop: 12 }}>
          <span className="mono">{found.pi}</span>{" "}
          <span className="dim">· {found.role} · joined {new Date(found.created_at).toLocaleDateString("en-IE")}</span>
          <div style={{ marginTop: 8 }}>
            <button className="primary" onClick={grant} disabled={pending || found.role !== "student"}>
              {found.role === "student" ? "Make trusted" : `Already ${found.role}`}
            </button>
          </div>
        </div>
      )}

      {done && <p style={{ marginTop: 10, color: "var(--ok)" }}>Trust granted.</p>}
      {error && <div className="err">{error}</div>}

      <p style={{ marginTop: 12, fontSize: 12, maxWidth: 560 }}>
        An ID identifies an account — it is not a password, and someone could pass you one
        that is not theirs. Only grant trust to a person you know, over a channel where you
        know who you are talking to.
      </p>
    </section>
  );
}
