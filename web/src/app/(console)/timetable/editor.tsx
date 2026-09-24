"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DcuClass, Week } from "@/lib/dcu/timetable";
import { checkChange, describeChange, weekday, type SavedChange, type TimetableChange } from "@/lib/changes/change";
import { saveChange, deleteChange, slotDates } from "./actions";
import { Spinner } from "../spinner";

type Props = {
  programmes: { key: string; name: string }[];
  programme: string;
  modules: { code: string; title: string }[];
  weeks: Week[];
  week: number | null;
  classes: DcuClass[];
  changes: SavedChange[];
  groups: string[];
};

/// One block on the grid: one of DCU's classes, or a class a change adds.
type Block = {
  id: string;
  date: string;
  start: string;
  end: string;
  module: string;
  label: string;
  room: string | null;
  /// Removed for everyone, removed for some groups, added, or untouched.
  state: "removed" | "partial" | "added" | "normal";
  badges: string[];
  source: { kind: "dcu"; c: DcuClass; removals: SavedChange[] } | { kind: "added"; change: SavedChange };
};

const HOUR = 56;

export function Editor(props: Props) {
  const { programme, weeks, week, classes, changes } = props;
  const router = useRouter();
  // The server fetches the new week; the transition keeps the old one on screen, dimmed,
  // so a click answers at once instead of after DCU does.
  const [loading, navigate] = useTransition();
  const [selected, setSelected] = useState<string | null>(null);
  const [viewing, setViewing] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => { setSelected(null); }, [week, programme]);

  const go = (p: string, w: number | null) => navigate(() => {
    router.push(`/timetable?programme=${encodeURIComponent(p)}${w ? `&week=${w}` : ""}`);
  });

  const shown = weeks.find((w) => w.number === week);
  const idx = weeks.findIndex((w) => w.number === week);
  const blocks = shown ? buildBlocks(classes, changes, shown, viewing) : [];
  const chosen = blocks.find((b) => b.id === selected) ?? null;

  return (
    <>
      <div className="tt-controls">
        <select value={programme} onChange={(e) => go(e.target.value, week)} disabled={loading} aria-label="Programme">
          {props.programmes.map((p) => <option key={p.key} value={p.key}>{p.key} · {p.name}</option>)}
        </select>
        <div className="tt-weeknav">
          <button type="button" disabled={loading || idx <= 0} onClick={() => go(programme, weeks[idx - 1].number)} aria-label="Previous week">‹</button>
          <select value={week ?? ""} onChange={(e) => go(programme, Number(e.target.value))} disabled={loading} aria-label="Week">
            {weeks.map((w) => <option key={w.number} value={w.number}>Week {w.label} · {shortDate(w.firstDay)}</option>)}
          </select>
          <button type="button" disabled={loading || idx < 0 || idx >= weeks.length - 1} onClick={() => go(programme, weeks[idx + 1].number)} aria-label="Next week">›</button>
          {loading && <Spinner />}
        </div>
        <label className="tt-viewing">
          Show for
          <select value={viewing} onChange={(e) => setViewing(e.target.value)}>
            <option value="">Everyone, with changes marked</option>
            {props.groups.map((g) => <option key={g} value={g}>Group {g}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => setAdding((a) => !a)} style={{ marginLeft: "auto" }}>
          {adding ? "Close" : "Add a class"}
        </button>
      </div>

      {adding && <AddForm {...props} onDone={() => setAdding(false)} />}

      {shown ? (
        <WeekGrid week={shown} blocks={blocks} selected={selected} dimmed={loading}
          onSelect={(id) => setSelected((s) => (s === id ? null : id))} />
      ) : (
        <div className="empty">No week to show.</div>
      )}

      {chosen && (
        <div className="tt-detail">
          {chosen.source.kind === "dcu"
            ? <ClassDetail key={chosen.id} c={chosen.source.c} removals={chosen.source.removals} props={props} onDone={() => setSelected(null)} />
            : <AddedDetail key={chosen.id} change={chosen.source.change} date={chosen.date} onDone={() => setSelected(null)} />}
        </div>
      )}

      <Saved changes={changes} />
    </>
  );
}

// ---------------------------------------------------------------------------
// The grid — days across, hours down, as the app draws it (WeekCalendarView.swift).

function WeekGrid({ week, blocks, selected, dimmed, onSelect }: {
  week: Week; blocks: Block[]; selected: string | null; dimmed: boolean; onSelect: (id: string) => void;
}) {
  const weekdays = [0, 1, 2, 3, 4].map((n) => addDays(week.firstDay, n));
  // A weekend day only when something is on it.
  const days = [...weekdays, ...[5, 6].map((n) => addDays(week.firstDay, n)).filter((d) => blocks.some((b) => b.date === d))];
  const hours = hourRange(blocks);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Dublin" });
  const columns = `48px repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <div className={`wk${dimmed ? " dimmed" : ""}`}>
      <div className="wk-scroll">
        <div className="wk-head" style={{ gridTemplateColumns: columns }}>
          <div />
          {days.map((d) => (
            <div key={d} className={d === today ? "wk-day-name today" : "wk-day-name"}>
              {weekday(d)} <span>{Number(d.slice(8))}</span>
            </div>
          ))}
        </div>
        <div className="wk-body" style={{ gridTemplateColumns: columns, height: (hours.length - 1) * HOUR }}>
          <div className="wk-hours">
            {hours.slice(0, -1).map((h, i) => (
              <div key={h} style={{ top: i * HOUR }}>{hourLabel(h)}</div>
            ))}
          </div>
          {days.map((d) => (
            <div key={d} className="wk-col">
              {hours.slice(1, -1).map((h, i) => <div key={h} className="wk-line" style={{ top: (i + 1) * HOUR }} />)}
              {place(blocks.filter((b) => b.date === d)).map(({ block, column, columns: n }) => {
                const top = (minutes(block.start) - hours[0] * 60) / 60 * HOUR;
                const height = Math.max(24, (minutes(block.end) - minutes(block.start)) / 60 * HOUR);
                return (
                  <button key={block.id} type="button"
                    className={`wk-block ${block.state}${selected === block.id ? " selected" : ""}`}
                    style={{
                      top: top + 1, height: height - 2,
                      left: `calc(${(column / n) * 100}% + 2px)`, width: `calc(${100 / n}% - 4px)`,
                      ["--c" as string]: tint(block.module),
                    }}
                    title={`${block.module} ${block.label} · ${block.start}–${block.end}${block.room ? ` · ${block.room}` : ""}`}
                    onClick={() => onSelect(block.id)}>
                    <strong>{block.module}</strong>
                    {height > 40 && <span>{block.label}</span>}
                    {height > 56 && block.room && <span className="dim">{block.room}</span>}
                    {block.badges.length > 0 && <em>{block.badges.join(" ")}</em>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/// What the grid shows. With no group chosen, everything, with changes marked; with a
/// group chosen, what a student in it sees — their removals gone, their additions in.
/// (The phone also swaps lab slots for the lab rotation; that isn't drawn here.)
function buildBlocks(classes: DcuClass[], changes: SavedChange[], week: Week, viewing: string): Block[] {
  const end = addDays(week.firstDay, 7);
  const out: Block[] = [];

  for (const c of classes) {
    const removals = changes.filter((x) => x.kind === "remove" && x.module === c.module && x.start === c.start &&
      x.dates.includes(c.date) && (!x.activityCode || x.activityCode === c.code));
    if (viewing && removals.some((r) => reaches(r.group, viewing))) continue;
    const everyone = removals.some((r) => !r.group);
    out.push({
      id: `dcu|${c.code}|${c.date}|${c.start}`, date: c.date, start: c.start, end: c.end, module: c.module,
      label: `${c.code.split("/").slice(1).join("/")} ${kindLabel(c.code)}`.trim(), room: c.rooms[0] ?? null,
      state: viewing ? "normal" : everyone ? "removed" : removals.length ? "partial" : "normal",
      badges: viewing ? [] : removals.map((r) => `−${r.group ?? "all"}`),
      source: { kind: "dcu", c, removals },
    });
  }
  for (const x of changes) {
    if (x.kind !== "add" || !x.end || (viewing && !reaches(x.group, viewing))) continue;
    for (const date of x.dates.filter((d) => d >= week.firstDay && d < end)) {
      out.push({
        id: `add|${x.id}|${date}`, date, start: x.start, end: x.end, module: x.module,
        label: x.title ?? "", room: x.room, state: "added",
        badges: viewing ? [] : [`+${x.group ?? "all"}`],
        source: { kind: "added", change: x },
      });
    }
  }
  return out;
}

/// A change for "C" reaches everyone in C, including C.2; one for "C.2" reaches only C.2.
function reaches(target: string | null, viewing: string): boolean {
  return !target || target === viewing || (viewing.includes(".") && target === viewing.split(".")[0]);
}

/// Side-by-side columns for classes that overlap, as WeekGrid.swift places them.
function place(blocks: Block[]) {
  const sorted = [...blocks].sort((a, b) => a.start === b.start ? a.end.localeCompare(b.end) : a.start.localeCompare(b.start));
  const out: { block: Block; column: number; columns: number }[] = [];
  let cluster: Block[] = [];
  let clusterEnd = "";
  const flush = () => {
    const ends: string[] = [];
    const placed = cluster.map((b) => {
      let col = ends.findIndex((e) => e <= b.start);
      if (col < 0) { ends.push(b.end); col = ends.length - 1; } else ends[col] = b.end;
      return { block: b, column: col };
    });
    out.push(...placed.map((p) => ({ ...p, columns: ends.length })));
    cluster = [];
  };
  for (const b of sorted) {
    if (cluster.length && b.start < clusterEnd) {
      cluster.push(b);
      if (b.end > clusterEnd) clusterEnd = b.end;
    } else {
      flush();
      cluster = [b];
      clusterEnd = b.end;
    }
  }
  flush();
  return out;
}

function hourRange(blocks: Block[]): number[] {
  if (!blocks.length) return range(9, 18);
  const low = Math.min(...blocks.map((b) => Math.floor(minutes(b.start) / 60)));
  const high = Math.max(low + 1, ...blocks.map((b) => Math.ceil(minutes(b.end) / 60)));
  return range(low, high);
}

/// The app's module colours, picked the same way (djb2 over the code, 64-bit), so a module
/// is the same colour in the console as on a student's phone. iOS's dark-mode system colours.
const TINTS = ["#0A84FF", "#30D158", "#BF5AF2", "#40C8E0", "#5E5CE6", "#FF375F", "#AC8E68"];
function tint(module: string): string {
  let hash = 5381n;
  for (const byte of new TextEncoder().encode(module)) hash = BigInt.asIntN(64, hash * 33n + BigInt(byte));
  const n = BigInt(TINTS.length);
  return TINTS[Number(((hash % n) + n) % n)];
}

// ---------------------------------------------------------------------------
// What opens under the grid when a block is clicked.

function ClassDetail({ c, removals, props, onDone }: {
  c: DcuClass; removals: SavedChange[]; props: Props; onDone: () => void;
}) {
  return (
    <>
      <div className="tt-detail-head">
        <h2>{c.module} <span className="dim">{c.code} · {kindLabel(c.code)}</span></h2>
        <button type="button" onClick={onDone} aria-label="Close">Close</button>
      </div>
      <p>{weekday(c.date)} {c.date} · {c.start}–{c.end}{c.rooms.length ? ` · ${c.rooms.join(", ")}` : ""}{c.title ? ` · ${c.title}` : ""}</p>
      {removals.length > 0 && (
        <p>Already removed for {removals.map((r) => r.group ?? "everyone").join(", ")}. Delete those under Saved changes to undo.</p>
      )}
      <RemoveForm c={c} props={props} onDone={onDone} />
    </>
  );
}

function AddedDetail({ change, date, onDone }: { change: SavedChange; date: string; onDone: () => void }) {
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <div className="tt-detail-head">
        <h2>{change.module} <span className="dim">{change.title} · added</span></h2>
        <button type="button" onClick={onDone} aria-label="Close">Close</button>
      </div>
      <p>
        {weekday(date)} {date} · {change.start}–{change.end}{change.room ? ` · ${change.room}` : ""} · for {change.group ? `group ${change.group}` : "everyone"} ·
        {" "}{change.dates.length} date{change.dates.length === 1 ? "" : "s"} in all{change.note ? ` · ${change.note}` : ""}
      </p>
      {error && <p className="err">{error}</p>}
      <button type="button" className="danger" disabled={busy} onClick={() => start(async () => {
        const res = await deleteChange(change.id);
        if (res.ok) onDone(); else setError(res.error);
      })}>
        {busy ? <><Spinner /> Deleting</> : `Delete this addition (all ${change.dates.length} date${change.dates.length === 1 ? "" : "s"})`}
      </button>
    </>
  );
}

function RemoveForm({ c, props, onDone }: { c: DcuClass; props: Props; onDone: () => void }) {
  const [group, setGroup] = useState("");
  const [every, setEvery] = useState(false);
  const [dates, setDates] = useState<string[]>([c.date]);
  const [onlyThis, setOnlyThis] = useState(true);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [finding, find] = useTransition();
  const [saving, start] = useTransition();

  function chooseEvery(on: boolean) {
    setEvery(on);
    setError(null);
    if (!on) { setDates([c.date]); return; }
    find(async () => {
      const res = await slotDates(c.module, c.code, c.day, c.start);
      if (res.ok) setDates(res.dates.length ? res.dates : [c.date]);
      else { setError(res.error); setEvery(false); }
    });
  }

  const change: TimetableChange = {
    courseKey: props.programme, group: group.trim().toUpperCase() || null, kind: "remove",
    module: c.module, activityCode: onlyThis ? c.code : null, title: null,
    dates, start: c.start, end: null, room: null, note: note.trim() || null,
  };
  const problems = checkChange(change);

  // Saving revalidates the page on the server, and the new grid arrives with the answer —
  // no second round trip to refresh it.
  const save = () => start(async () => {
    const res = await saveChange(change);
    if (res.ok) onDone(); else setError(res.error);
  });

  return (
    <div className="tt-edit">
      <div className="row" style={{ flexWrap: "wrap" }}>
        <div className="field" style={{ width: 140 }}>
          <label>Remove for</label>
          <GroupInput value={group} onChange={setGroup} groups={props.groups} />
        </div>
        <div className="field">
          <label>Dates</label>
          <div className="row" style={{ alignItems: "center", gap: 12 }}>
            <label className="check"><input type="radio" checked={!every} onChange={() => chooseEvery(false)} /> {c.day} {shortDate(c.date)} only</label>
            <label className="check"><input type="radio" checked={every} onChange={() => chooseEvery(true)} /> Every week it runs</label>
            {finding && <Spinner />}
          </div>
        </div>
        <div className="field">
          <label>Which class</label>
          <label className="check"><input type="checkbox" checked={onlyThis} onChange={(e) => setOnlyThis(e.target.checked)} /> Only {c.code}</label>
        </div>
        <div className="field" style={{ flex: 1, minWidth: 160 }}>
          <label>Note (optional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why — for the audit log" />
        </div>
      </div>
      {every && !finding && <p className="dim" style={{ fontSize: 12 }}>{dates.length} date{dates.length === 1 ? "" : "s"}: {dates.map(shortDate).join(", ")}</p>}
      {problems.map((p, i) => <p key={i} className={p.level === "error" ? "tag off" : "tag warn"}>{p.message}</p>)}
      {error && <p className="err">{error}</p>}
      <button className="primary" onClick={save} disabled={saving || finding || problems.some((p) => p.level === "error")}>
        {saving ? <><Spinner /> Saving</> : `Remove for ${change.group ?? "everyone"}`}
      </button>
    </div>
  );
}

function AddForm(props: Props & { onDone: () => void }) {
  const shown = props.weeks.find((w) => w.number === props.week);
  const [module, setModule] = useState(props.modules[0]?.code ?? "");
  const [title, setTitle] = useState("");
  const [group, setGroup] = useState("");
  const [first, setFirst] = useState(shown?.firstDay ?? "");
  const [repeat, setRepeat] = useState(1);
  const [startTime, setStartTime] = useState("");
  const [end, setEnd] = useState("");
  const [room, setRoom] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();

  const dates = first ? Array.from({ length: Math.max(1, Math.min(repeat, 30)) }, (_, i) => addDays(first, 7 * i)) : [];
  const change: TimetableChange = {
    courseKey: props.programme, group: group.trim().toUpperCase() || null, kind: "add",
    module, activityCode: null, title: title.trim() || null, dates, start: startTime,
    end: end || null, room: room.trim() || null, note: note.trim() || null,
  };
  const problems = checkChange(change);

  const save = () => start(async () => {
    const res = await saveChange(change);
    if (res.ok) props.onDone(); else setError(res.error);
  });

  return (
    <div className="tt-edit tt-add">
      <div className="row" style={{ flexWrap: "wrap" }}>
        <div className="field" style={{ width: 150 }}>
          <label>Module</label>
          <select value={module} onChange={(e) => setModule(e.target.value)}>
            {props.modules.map((m) => <option key={m.code} value={m.code}>{m.code}</option>)}
          </select>
        </div>
        <div className="field" style={{ width: 160 }}>
          <label>What</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Lab, Tutorial…" />
        </div>
        <div className="field" style={{ width: 140 }}>
          <label>For</label>
          <GroupInput value={group} onChange={setGroup} groups={props.groups} />
        </div>
        <div className="field" style={{ width: 160 }}>
          <label>First date</label>
          <input type="date" value={first} onChange={(e) => setFirst(e.target.value)} />
        </div>
        <div className="field" style={{ width: 110 }}>
          <label>Weeks</label>
          <input type="number" min={1} max={30} value={repeat} onChange={(e) => setRepeat(Number(e.target.value) || 1)} />
        </div>
        <div className="field" style={{ width: 110 }}>
          <label>Start</label>
          <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </div>
        <div className="field" style={{ width: 110 }}>
          <label>End</label>
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <div className="field" style={{ width: 130 }}>
          <label>Room</label>
          <input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="GLA.S210" />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 160 }}>
          <label>Note (optional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      {dates.length > 0 && (
        <p className="dim" style={{ fontSize: 12 }}>{dates.map((d) => `${weekday(d)} ${shortDate(d)}`).join(", ")}</p>
      )}
      {problems.map((p, i) => <p key={i} className={p.level === "error" ? "tag off" : "tag warn"}>{p.message}</p>)}
      {error && <p className="err">{error}</p>}
      <button className="primary" onClick={save} disabled={saving || problems.some((p) => p.level === "error")}>
        {saving ? <><Spinner /> Saving</> : `Add for ${change.group ?? "everyone"}`}
      </button>
    </div>
  );
}

function Saved({ changes }: { changes: SavedChange[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  const remove = (id: string) => {
    setBusy(id);
    setError(null);
    start(async () => {
      const res = await deleteChange(id);
      setBusy(null);
      if (!res.ok) setError(res.error);
    });
  };

  return (
    <div className="saved">
      <div className="saved-head"><h2>Saved changes</h2><span className="dim">{changes.length}</span></div>
      {error && <p className="err">{error}</p>}
      {changes.length === 0 ? (
        <div className="empty" style={{ padding: "8px 0" }}>None for this programme.</div>
      ) : (
        <table>
          <thead><tr><th>Change</th><th>Dates</th><th>Note</th><th /></tr></thead>
          <tbody>
            {changes.map((c) => (
              <tr key={c.id}>
                <td>{describeChange(c)}</td>
                <td className="dim" style={{ maxWidth: 320 }}>{c.dates.map(shortDate).join(", ")}</td>
                <td className="dim">{c.note ?? "—"}</td>
                <td className="right">
                  <button type="button" className="danger" disabled={busy === c.id} onClick={() => remove(c.id)}>
                    {busy === c.id ? <Spinner /> : "Delete"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/// Free text with the known groups offered: blank means everyone on the course.
function GroupInput({ value, onChange, groups }: { value: string; onChange: (v: string) => void; groups: string[] }) {
  return (
    <>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Everyone" list="tt-groups" />
      <datalist id="tt-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
    </>
  );
}

// ---------------------------------------------------------------------------

/// The kind of class, from the letter DCU puts in the code (…OC/P1/02 is a practical) —
/// the same letters ActivityCode.swift reads. The API's own event type says "On Campus"
/// for most of them, which isn't a kind.
function kindLabel(code: string): string {
  const letter = code.split("/")[1]?.[0]?.toUpperCase();
  return ({ L: "Lecture", T: "Tutorial", P: "Lab", S: "Seminar", W: "Workshop" } as Record<string, string>)[letter ?? ""] ?? "Class";
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function hourLabel(h: number): string {
  return `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "am" : "pm"}`;
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

function shortDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-IE", { day: "numeric", month: "short", timeZone: "UTC" });
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
