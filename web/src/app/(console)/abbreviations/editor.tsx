"use client";

import { useEffect, useState, useTransition } from "react";
import {
  ABBREVIATION_AIM, ABBREVIATION_LIMIT, abbreviationProblem, clashes, NO_ENTRY, normalEntry, sameEntry, type Entry,
} from "@/lib/abbreviations/check";
import type { Course, CourseModule } from "@/lib/abbreviations/modules";
import { save, suggest } from "./actions";
import { Spinner } from "../spinner";

type Filter = "all" | "flagged" | "unset";

/// Every change stays on this page until Save, the assistant's included. Only then does it
/// reach the app, so a batch of suggestions is looked over before a student sees any of it.
export function Editor({ courses, saved }: { courses: Course[]; saved: Record<string, Entry> }) {
  const [drafts, setDrafts] = useState<Record<string, Entry>>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [running, setRunning] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [saving, startSave] = useTransition();

  const savedOf = (code: string) => saved[code] ?? NO_ENTRY;
  const current = (code: string) => drafts[code] ?? savedOf(code);

  // Once a save comes back, what it saved is no longer a change.
  useEffect(() => {
    setDrafts((d) => {
      const left = Object.entries(d).filter(([code, e]) => !sameEntry(e, saved[code] ?? NO_ENTRY));
      return left.length === Object.keys(d).length ? d : Object.fromEntries(left);
    });
  }, [saved]);

  function edit(code: string, next: Entry) {
    setDrafts((d) => {
      const out = { ...d };
      if (sameEntry(next, saved[code] ?? NO_ENTRY)) delete out[code];
      else out[code] = next;
      return out;
    });
  }

  async function runAssistant(course: Course) {
    setRunning(course.key);
    setNotice(null);
    const res = await suggest(course.key).catch((e: unknown) => ({
      ok: false as const, error: e instanceof Error ? e.message : "The assistant couldn't be reached.",
    }));
    setRunning(null);
    if (!res.ok) {
      setNotice({ text: res.error, error: true });
      return;
    }
    setDrafts((d) => {
      const out = { ...d };
      for (const s of res.suggestions) {
        // A row someone is typing in is theirs.
        if (out[s.code]?.source === "manual") continue;
        const was = out[s.code] ?? saved[s.code] ?? NO_ENTRY;
        // A flagged module keeps what it had: the guess waits for a person to pick it.
        const next: Entry = s.flag
          ? { abbreviation: was.abbreviation, source: was.source, flag: s.flag, suggestion: s.abbreviation }
          : { abbreviation: s.abbreviation, source: "ai", flag: null, suggestion: null };
        if (sameEntry(next, saved[s.code] ?? NO_ENTRY)) delete out[s.code];
        else out[s.code] = next;
      }
      return out;
    });
    const flagged = res.suggestions.filter((s) => s.flag).length;
    const done = res.suggestions.length - flagged;
    setNotice({
      text: res.suggestions.length === 0
        ? "Every module of this course has been set by hand, so there was nothing for the assistant to do."
        : `The assistant suggested ${plural(done, "abbreviation")} and flagged ${plural(flagged, "module")} for you to look at.` +
          (res.skipped ? ` It left the ${plural(res.skipped, "module")} set by hand alone.` : "") +
          " Nothing reaches the app until you save.",
    });
  }

  const changed = Object.entries(drafts);
  const blocked = changed.filter(([, e]) => e.abbreviation !== null && abbreviationProblem(e.abbreviation)).length;

  function saveAll() {
    const edits = changed.map(([code, entry]) => ({ code, entry: normalEntry(entry) }));
    setNotice(null);
    startSave(async () => {
      const res = await save(edits).catch((e: unknown) => ({
        ok: false as const, error: e instanceof Error ? e.message : "Couldn't save.",
      }));
      if (!res.ok) {
        setNotice({ text: res.error, error: true });
        return;
      }
      // What was sent is saved, unless it was typed over while saving. In a transition, so
      // it lands with the page's new data rather than showing the old for a moment.
      const sent = new Map(edits.map((x) => [x.code, x.entry]));
      startSave(() => {
        setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([code, e]) => {
          const s = sent.get(code);
          return !(s && sameEntry(normalEntry(e), s));
        })));
        setNotice({ text: `Saved ${plural(res.changed, "module")}.` });
      });
    });
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (changed.length && !blocked && !saving) saveAll(); }}>
      <div className="tt-controls">
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Show">
          <option value="all">All modules</option>
          <option value="flagged">Flagged</option>
          <option value="unset">Not set</option>
        </select>
        {notice && <p className={notice.error ? "err abbr-notice" : "abbr-notice"} role="status">{notice.text}</p>}
      </div>

      {courses.map((course) => {
        const entries = course.modules.map((m) => ({ ...m, abbreviation: current(m.code).abbreviation }));
        const clash = clashes(entries);
        const flagged = course.modules.filter((m) => current(m.code).flag).length;
        const shown = course.modules.filter((m) =>
          filter === "all" || (filter === "flagged" ? current(m.code).flag : !current(m.code).abbreviation));
        return (
          <section key={course.key}>
            <div className="abbr-head">
              <h2>{course.name}</h2>
              <span className="dim">
                {plural(course.modules.length, "module")}{flagged ? `, ${flagged} flagged` : ""}
              </span>
              <button
                type="button"
                onClick={() => runAssistant(course)}
                disabled={running !== null || saving}
                title="Suggests an abbreviation for each module not set by hand. Nothing reaches the app until you save."
              >
                {running === course.key ? <><Spinner /> Suggesting</> : "Suggest with the assistant"}
              </button>
            </div>
            <p className="abbr-covers">{course.covers.join(", ")}</p>
            {course.failed && <p className="err">{course.failed}</p>}
            <table className="abbr-table">
              <thead>
                <tr><th className="abbr-code">Code</th><th>DCU&rsquo;s name</th><th className="abbr-grid">Week grid</th><th className="abbr-state" /></tr>
              </thead>
              <tbody>
                {shown.map((m) => (
                  <ModuleRow
                    key={m.code}
                    module={m}
                    entry={current(m.code)}
                    saved={savedOf(m.code)}
                    clash={clash.get(m.code)?.name ?? null}
                    onEdit={(next) => edit(m.code, next)}
                  />
                ))}
                {shown.length === 0 && (
                  <tr><td colSpan={4} className="dim">{filter === "flagged" ? "Nothing flagged." : "Every module has one."}</td></tr>
                )}
              </tbody>
            </table>
          </section>
        );
      })}

      {changed.length > 0 && (
        <div className="savebar">
          <span className="grow">
            {plural(changed.length, "unsaved change")}
            {blocked ? <span className="tag off">, {blocked} to fix before saving</span> : null}
          </span>
          <button type="button" className="link" onClick={() => setDrafts({})} disabled={saving}>Discard</button>
          <button type="submit" className="primary" disabled={saving || blocked > 0}>
            {saving ? "Saving" : "Save"}
          </button>
        </div>
      )}
    </form>
  );
}

function ModuleRow({ module, entry, saved, clash, onEdit }: {
  module: CourseModule;
  entry: Entry;
  saved: Entry;
  clash: string | null;
  onEdit: (next: Entry) => void;
}) {
  const text = entry.abbreviation ?? "";
  const problem = entry.abbreviation !== null ? abbreviationProblem(entry.abbreviation) : null;
  const dirty = !sameEntry(entry, saved);
  const length = text.trim().length;

  return (
    <tr>
      <td className="mono dim">{module.code}</td>
      <td>{module.name || <span className="dim">DCU gives it no name</span>}</td>
      <td>
        <div className="abbr-input">
          <input
            value={text}
            placeholder="Automatic"
            maxLength={40}
            aria-label={`Week-grid name for ${module.name || module.code}`}
            aria-invalid={problem ? true : undefined}
            // A person typing has decided, so it's theirs and any flag is answered.
            onChange={(e) => onEdit({
              abbreviation: e.target.value.trim() ? e.target.value : null,
              source: e.target.value.trim() ? "manual" : null,
              flag: null,
              suggestion: null,
            })}
          />
          <span className={length > ABBREVIATION_AIM ? "abbr-count warn" : "abbr-count"}
                title={length > ABBREVIATION_AIM ? "Wraps onto a second line in a one-hour block" : undefined}>
            {length ? `${length}/${ABBREVIATION_LIMIT}` : ""}
          </span>
        </div>
        {problem && <div className="err abbr-note">{problem}</div>}
        {!problem && clash && <div className="tag warn abbr-note">Reads the same as {clash}.</div>}
      </td>
      <td className="abbr-status">
        {entry.flag ? (
          <>
            <span className="tag warn">Flagged</span> <span className="muted">{entry.flag}</span>
            <span className="abbr-actions">
              {entry.suggestion && entry.suggestion !== entry.abbreviation && (
                <button type="button" className="link"
                        onClick={() => onEdit({ abbreviation: entry.suggestion, source: "manual", flag: null, suggestion: null })}>
                  Use &ldquo;{entry.suggestion}&rdquo;
                </button>
              )}
              <button type="button" className="link" onClick={() => onEdit({ ...entry, flag: null, suggestion: null })}
                      title={entry.abbreviation ? "Keeps the abbreviation it has" : "Leaves it to the app to shorten DCU's name"}>
                Dismiss
              </button>
            </span>
          </>
        ) : (
          <span className="tag">
            {dirty ? (entry.source === "ai" ? "Suggested, unsaved" : "Unsaved")
              : entry.abbreviation ? (entry.source === "ai" ? "From the assistant" : "Set by hand")
              : ""}
          </span>
        )}
        {entry.abbreviation && !entry.flag && (
          <span className="abbr-actions">
            <button type="button" className="link" onClick={() => onEdit(NO_ENTRY)}>Clear</button>
          </span>
        )}
      </td>
    </tr>
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
