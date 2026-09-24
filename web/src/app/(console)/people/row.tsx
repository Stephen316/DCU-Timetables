"use client";

import { useState, useTransition } from "react";
import { setBan, setRole } from "../actions";
import { Spinner } from "../spinner";
import type { Contributor } from "./page";

const joined = new Intl.DateTimeFormat("en-IE", { day: "numeric", month: "short", year: "2-digit" });

export function PersonRow({ person, isMe }: { person: Contributor; isMe: boolean }) {
  const [pending, start] = useTransition();
  const [action, setAction] = useState<"ban" | "unban" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const banned = person.banned_until !== null && new Date(person.banned_until) > new Date();

  function run(fn: () => Promise<{ error?: string }>) {
    start(async () => setError((await fn()).error ?? null));
  }

  return (
    <tr>
      <td className="mono">{person.pi ?? "--"}</td>
      <td>
        <span className={person.role === "student" ? "dim" : "tag ok"}>{person.role}</span>
        {isMe && <span className="dim"> · you</span>}
        {banned && <span className="tag off"> · banned</span>}
        {error && <div className="err">{error}</div>}
      </td>
      <td className="dim">{joined.format(new Date(person.created_at))}</td>
      <td className="right dim">{person.reports}</td>
      <td className="right dim">{person.deadlines}</td>
      <td className="right dim">{person.confirmations}</td>
      {/* The number that actually means something: raw volume flags your best
          contributors as loudly as your worst. */}
      <td className={person.rejected > 0 ? "right tag off" : "right dim"}>{person.rejected}</td>
      <td className="right" style={{ whiteSpace: "nowrap" }}>
        {/* No actions on your own row. `set_user_ban` refuses a self-ban and
            `set_user_role` refuses removing the last admin, so these buttons could only
            ever produce an error — and an action you are offered but cannot take reads as
            a broken console, not a guard rail. */}
        {isMe ? (
          <span className="dim">--</span>
        ) : (
          <>
        {person.role === "trusted" && (
          <>
            <button disabled={pending} onClick={() => run(() => setRole(person.id, "student"))}>
              Remove trust
            </button>{" "}
          </>
        )}
        {banned ? (
          <button disabled={pending} onClick={() => { setAction("unban"); run(() => setBan(person.id, null, "")); }}>
            {pending && action === "unban" ? <><Spinner /> Working</> : "Unban"}
          </button>
        ) : (
          <button className="danger" disabled={pending}
                  onClick={() => {
                    if (!window.confirm(`Ban ${person.pi ?? "this account"} for 30 days? They can't post or confirm until it ends.`)) return;
                    setAction("ban");
                    run(() => setBan(person.id, 30, "False activity"));
                  }}>
            {pending && action === "ban" ? <><Spinner /> Banning</> : "Ban 30d"}
          </button>
        )}
          </>
        )}
      </td>
    </tr>
  );
}
