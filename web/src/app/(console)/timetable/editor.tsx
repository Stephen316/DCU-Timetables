"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DcuClass, Week } from "@/lib/dcu/timetable";
import { audience, checkChange, describeChange, edited, groupList, weekday, type SavedChange, type TimetableChange } from "@/lib/changes/change";
import type { Finding } from "@/lib/extraction/rotation";
import { PROGRAMME_CODE } from "@/lib/proposals/courses";
import { saveChanges, deleteChange, slotDates } from "./actions";
import { Spinner } from "../spinner";

type Props = {
  programmes: { key: string; name: string }[];
  programme: string;
  modules: { code: string; title: string }[];
  weeks: Week[];
  week: number | null;
  classes: DcuClass[];
  changes: SavedChange[];
  /// Lab groups and subgroups the console knows for the course.
  groups: string[];
  /// The DCU programmes the course covers, each a group of it.
  programmeGroups: { code: string; name: string }[];
};

/// Whose timetable the grid shows: a programme, a lab group, both, or neither (everything,
/// with changes marked). A student is in one of each.
type Viewer = { programme: string; group: string };

/// One block on the grid: one of DCU's classes, or a class a change adds.
type Block = {
  id: string;
  date: string;
  start: string;
  end: string;
  module: string;
  label: string;
  /// As the viewer sees them: DCU's, or an edit's.
  room: string | null;
  staff: string | null;
  /// Removed for everyone, removed for some groups, added, or untouched.
  state: "removed" | "partial" | "added" | "normal";
  badges: string[];
  /// Who has a new room or lecturer for it: "✎all", "✎CE1".
  edited: string[];
  source: { kind: "dcu"; c: DcuClass; removals: SavedChange[]; edits: SavedChange[] } | { kind: "added"; change: SavedChange };
};

const HOUR = 56;

export function Editor(props: Props) {
  const { programme, weeks, week, classes, changes } = props;
  const router = useRouter();
  // The server fetches the new week; the transition keeps the old one on screen, dimmed,
  // so a click answers at once instead of after DCU does.
  const [loading, navigate] = useTransition();
  const [selected, setSelected] = useState<string | null>(null);
  const [viewer, setViewer] = useState<Viewer>({ programme: "", group: "" });
  const [adding, setAdding] = useState(false);

  useEffect(() => { setSelected(null); }, [week, programme]);

  const go = (p: string, w: number | null) => navigate(() => {
    router.push(`/timetable?programme=${encodeURIComponent(p)}${w ? `&week=${w}` : ""}`);
  });

  const shown = weeks.find((w) => w.number === week);
  const idx = weeks.findIndex((w) => w.number === week);
  const blocks = shown ? buildBlocks(classes, changes, shown, viewer) : [];
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
        <div className="tt-viewing">
          Show for
          <select value={viewer.programme} onChange={(e) => setViewer((v) => ({ ...v, programme: e.target.value }))} aria-label="Show for programme">
            <option value="">Every programme</option>
            {props.programmeGroups.map((p) => <option key={p.code} value={p.code} title={p.name}>{p.code}</option>)}
          </select>
          <select value={viewer.group} onChange={(e) => setViewer((v) => ({ ...v, group: e.target.value }))} aria-label="Show for group">
            <option value="">Every group</option>
            {props.groups.map((g) => <option key={g} value={g}>Group {g}</option>)}
          </select>
        </div>
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
            ? <ClassDetail key={chosen.id} c={chosen.source.c} removals={chosen.source.removals} edits={chosen.source.edits}
                props={props} onDone={() => setSelected(null)} />
            : <AddedDetail key={chosen.id} change={chosen.source.change} date={chosen.date} onDone={() => setSelected(null)} />}
        </div>
      )}

      <Saved changes={changes} />
    </>
  );
}

// ---------------------------------------------------------------------------
// The grid — days across, hours down, as the app draws it (mobile/src/features/week/WeekGrid.tsx).

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
                    title={`${block.module} ${block.label} · ${block.start}–${block.end}${block.room ? ` · ${block.room}` : ""}${block.staff ? ` · ${block.staff}` : ""}`}
                    onClick={() => onSelect(block.id)}>
                    <strong>{block.module}</strong>
                    {height > 40 && <span>{block.label}</span>}
                    {height > 56 && block.room && <span className="dim">{block.room}</span>}
                    {block.badges.length > 0 && <em>{block.badges.join(" ")}</em>}
                    {block.edited.length > 0 && <em className="edit">{block.edited.join(" ")}</em>}
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

/// What the grid shows. With nobody chosen, everything, with changes marked; with a
/// programme or group chosen, what a student in it sees — their removals gone, their
/// additions in, their rooms and lecturers changed. (The phone also swaps lab slots for the
/// lab rotation; that isn't drawn here.)
function buildBlocks(classes: DcuClass[], changes: SavedChange[], week: Week, viewer: Viewer): Block[] {
  const end = addDays(week.firstDay, 7);
  const viewing = !!(viewer.programme || viewer.group);
  const out: Block[] = [];

  for (const c of classes) {
    const removals = changes.filter((x) => x.kind === "remove" && finds(x, c));
    const edits = changes.filter((x) => x.kind === "edit" && finds(x, c));
    if (viewing && removals.some((r) => reaches(r.group, viewer))) continue;
    const everyone = removals.some((r) => !r.group);
    // Viewing no one, a class shows what everyone sees: only the edits for everyone.
    const now = shownAs(c, edits, (group) => (viewing ? reaches(group, viewer) : !group));
    out.push({
      id: `dcu|${c.code}|${c.date}|${c.start}`, date: c.date, start: c.start, end: c.end, module: c.module,
      label: `${c.code.split("/").slice(1).join("/")} ${kindLabel(c.code)}`.trim(), room: now.room, staff: now.staff,
      state: viewing ? "normal" : everyone ? "removed" : removals.length ? "partial" : "normal",
      badges: viewing ? [] : removals.map((r) => `−${r.group ?? "all"}`),
      edited: viewing ? [] : edits.map((e) => `✎${e.group ?? "all"}`),
      source: { kind: "dcu", c, removals, edits },
    });
  }
  for (const x of changes) {
    if (x.kind !== "add" || !x.end || (viewing && !reaches(x.group, viewer))) continue;
    for (const date of x.dates.filter((d) => d >= week.firstDay && d < end)) {
      out.push({
        id: `add|${x.id}|${date}`, date, start: x.start, end: x.end, module: x.module,
        label: x.title ?? "", room: x.room, staff: x.staff, state: "added",
        badges: viewing ? [] : [`+${x.group ?? "all"}`], edited: [],
        source: { kind: "added", change: x },
      });
    }
  }
  return out;
}

/// The class a removal or an edit finds, as the phone finds it (mobile/src/core/profile.ts).
function finds(x: SavedChange, c: DcuClass): boolean {
  return x.module === c.module && x.start === c.start && x.dates.includes(c.date) && (!x.activityCode || x.activityCode === c.code);
}

/// The room and lecturer a class shows: DCU's, with each edit that reaches the viewer put on
/// in the order the edits were saved, so a later one wins — as on the phone.
function shownAs(c: DcuClass, edits: SavedChange[], reaching: (group: string | null) => boolean) {
  let room = c.rooms.join(", ") || null;
  let staff = c.staff.join(", ") || null;
  for (const e of edits.filter((x) => reaching(x.group))) {
    room = e.room ?? room;
    staff = e.staff ?? staff;
  }
  return { room, staff };
}

/// A change for "C" reaches everyone in C, including C.2; one for "C.2" reaches only C.2;
/// one for "BMED1" reaches Biomedical students whatever their lab group.
function reaches(target: string | null, viewer: Viewer): boolean {
  if (!target) return true;
  if (PROGRAMME_CODE.test(target)) return target === viewer.programme;
  const g = viewer.group;
  return target === g || (g.includes(".") && target === g.split(".")[0]);
}

/// Side-by-side columns for classes that overlap, as the app's WeekGrid places them (mobile/src/core/schedule.ts).
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

function ClassDetail({ c, removals, edits, props, onDone }: {
  c: DcuClass; removals: SavedChange[]; edits: SavedChange[]; props: Props; onDone: () => void;
}) {
  const [mode, setMode] = useState<"remove" | "edit">("remove");
  return (
    <>
      <div className="tt-detail-head">
        <h2>{c.module} <span className="dim">{c.code} · {kindLabel(c.code)}</span></h2>
        <button type="button" onClick={onDone} aria-label="Close">Close</button>
      </div>
      <p>
        {weekday(c.date)} {c.date} · {c.start}–{c.end}{c.rooms.length ? ` · ${c.rooms.join(", ")}` : ""}
        {c.staff.length ? ` · ${c.staff.join(", ")}` : ""}{c.title ? ` · ${c.title}` : ""}
      </p>
      {removals.length > 0 && (
        <p>Already removed for {removals.map((r) => audience(r.group)).join(", ")}. Delete those under Saved changes to undo.</p>
      )}
      {edits.length > 0 && (
        <p>Already changed: {edits.map((e) => `${edited(e)} for ${audience(e.group)}`).join("; ")}. Delete those under Saved changes to undo.</p>
      )}
      <div className="tt-modes" role="tablist">
        <button type="button" role="tab" aria-selected={mode === "remove"} onClick={() => setMode("remove")}>Remove</button>
        <button type="button" role="tab" aria-selected={mode === "edit"} onClick={() => setMode("edit")}>Change room or lecturer</button>
      </div>
      {mode === "remove"
        ? <RemoveForm c={c} removals={removals} props={props} onDone={onDone} />
        : <EditForm c={c} props={props} onDone={onDone} />}
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
        {weekday(date)} {date} · {change.start}–{change.end}{change.room ? ` · ${change.room}` : ""}{change.staff ? ` · ${change.staff}` : ""} · for {audience(change.group)} ·
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

function RemoveForm({ c, removals, props, onDone }: {
  c: DcuClass; removals: SavedChange[]; props: Props; onDone: () => void;
}) {
  const programmes = props.programmeGroups.map((p) => p.code);
  // Gone on this date already, for everyone or for that programme.
  const removedFor = new Set(programmes.filter((p) => removals.some((r) => r.group === null || r.group === p)));
  const [keeps, setKeeps] = useState<Set<string>>(() => new Set(programmes));
  const [group, setGroup] = useState("");
  const slot = useSlotDates(c);
  const { dates, finding } = slot;
  const [onlyThis, setOnlyThis] = useState(true);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();

  const byGroup = group.trim() !== "" || !programmes.length;
  const dropped = programmes.filter((p) => !keeps.has(p) && !removedFor.has(p));
  const kept = programmes.filter((p) => keeps.has(p) && !removedFor.has(p));
  // Every programme unticked is one removal for everyone, not six.
  const targets: (string | null)[] = byGroup ? groupList(group) : !dropped.length ? [] : !kept.length ? [null] : dropped;
  const changes: TimetableChange[] = targets.map((g) => ({
    courseKey: props.programme, group: g, kind: "remove",
    module: c.module, activityCode: onlyThis ? c.code : null, title: null,
    dates, start: c.start, end: null, room: null, staff: null, note: note.trim() || null,
  }));
  const problems = findingsOf(changes);

  // Saving revalidates the page on the server, and the new grid arrives with the answer —
  // no second round trip to refresh it.
  const save = () => start(async () => {
    const res = await saveChanges(changes);
    if (res.ok) onDone(); else setError(res.error);
  });

  return (
    <div className="tt-edit">
      {programmes.length > 0 && (
        <ProgrammeTicks programmes={props.programmeGroups} ticked={keeps} locked={removedFor}
          disabled={group.trim() !== ""} onChange={setKeeps} />
      )}
      <div className="row" style={{ flexWrap: "wrap" }}>
        <div className="field" style={{ width: 190 }}>
          <label>{programmes.length ? "Or remove for lab groups" : "Remove for"}</label>
          <GroupInput value={group} onChange={setGroup} groups={props.groups}
            programmes={programmes.length ? [] : props.programmeGroups}
            placeholder={programmes.length ? "C, D.1" : "Everyone"} disabled={dropped.length > 0} />
        </div>
        <DatesField c={c} slot={slot} />
        <div className="field">
          <label>Which class</label>
          <label className="check"><input type="checkbox" checked={onlyThis} onChange={(e) => setOnlyThis(e.target.checked)} /> Only {c.code}</label>
        </div>
        <div className="field" style={{ flex: 1, minWidth: 160 }}>
          <label>Note (optional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why — for the audit log" />
        </div>
      </div>
      <DatesList slot={slot} />
      {problems.map((p, i) => <p key={i} className={p.level === "error" ? "tag off" : "tag warn"}>{p.message}</p>)}
      {(slot.error ?? error) && <p className="err">{slot.error ?? error}</p>}
      <button className="primary" onClick={save}
        disabled={saving || finding || !changes.length || problems.some((p) => p.level === "error")}>
        {saving ? <><Spinner /> Saving</>
          : !changes.length ? "Untick the programmes losing this class, or name lab groups"
          : !byGroup && targets[0] !== null ? `Remove for ${dropped.join(", ")} · ${kept.join(", ")} keep${kept.length === 1 ? "s" : ""} it`
          : `Remove for ${targets.map(audience).join(", ")}`}
      </button>
    </div>
  );
}

/// A class that still runs, somewhere else or with someone else. A field left blank keeps
/// DCU's, so a new lecturer alone doesn't freeze today's room into the change.
function EditForm({ c, props, onDone }: { c: DcuClass; props: Props; onDone: () => void }) {
  const programmes = props.programmeGroups.map((p) => p.code);
  const [room, setRoom] = useState("");
  const [staff, setStaff] = useState("");
  const [has, setHas] = useState<Set<string>>(() => new Set(programmes));
  const [group, setGroup] = useState("");
  const slot = useSlotDates(c);
  const [onlyThis, setOnlyThis] = useState(true);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();

  const byGroup = group.trim() !== "" || !programmes.length;
  const ticked = programmes.filter((p) => has.has(p));
  // Every programme ticked is one edit for everyone, not six.
  const targets: (string | null)[] = byGroup ? groupList(group) : ticked.length === programmes.length ? [null] : ticked;
  // What DCU already says is no change.
  const newRoom = room.trim() && room.trim() !== c.rooms.join(", ") ? room.trim() : null;
  const newStaff = staff.trim() && staff.trim() !== c.staff.join(", ") ? staff.trim() : null;
  const changes: TimetableChange[] = newRoom || newStaff ? targets.map((g) => ({
    courseKey: props.programme, group: g, kind: "edit",
    module: c.module, activityCode: onlyThis ? c.code : null, title: null,
    dates: slot.dates, start: c.start, end: null, room: newRoom, staff: newStaff, note: note.trim() || null,
  })) : [];
  const problems = findingsOf(changes);

  const save = () => start(async () => {
    const res = await saveChanges(changes);
    if (res.ok) onDone(); else setError(res.error);
  });

  return (
    <div className="tt-edit">
      {programmes.length > 0 && (
        <ProgrammeTicks label="Programmes it changes for" programmes={props.programmeGroups} ticked={has}
          disabled={group.trim() !== ""} onChange={setHas} />
      )}
      <div className="row" style={{ flexWrap: "wrap" }}>
        <div className="field" style={{ width: 160 }}>
          <label>New room</label>
          <input value={room} onChange={(e) => setRoom(e.target.value)} placeholder={c.rooms.join(", ") || "None listed"} maxLength={80} />
        </div>
        <div className="field" style={{ width: 200 }}>
          <label>New lecturer</label>
          <input value={staff} onChange={(e) => setStaff(e.target.value)} placeholder={c.staff.join(", ") || "None listed"} maxLength={120} />
        </div>
        <div className="field" style={{ width: 190 }}>
          <label>{programmes.length ? "Or only lab groups" : "For"}</label>
          <GroupInput value={group} onChange={setGroup} groups={props.groups}
            programmes={programmes.length ? [] : props.programmeGroups}
            placeholder={programmes.length ? "C, D.1" : "Everyone"} disabled={ticked.length < programmes.length} />
        </div>
        <DatesField c={c} slot={slot} />
        <div className="field">
          <label>Which class</label>
          <label className="check"><input type="checkbox" checked={onlyThis} onChange={(e) => setOnlyThis(e.target.checked)} /> Only {c.code}</label>
        </div>
        <div className="field" style={{ flex: 1, minWidth: 160 }}>
          <label>Note (optional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why — for the audit log" />
        </div>
      </div>
      <DatesList slot={slot} />
      {problems.map((p, i) => <p key={i} className={p.level === "error" ? "tag off" : "tag warn"}>{p.message}</p>)}
      {(slot.error ?? error) && <p className="err">{slot.error ?? error}</p>}
      <button className="primary" onClick={save}
        disabled={saving || slot.finding || !changes.length || problems.some((p) => p.level === "error")}>
        {saving ? <><Spinner /> Saving</>
          : !newRoom && !newStaff ? "Type a new room or lecturer"
          : !changes.length ? "Tick the programmes it changes for"
          : `Change to ${edited({ room: newRoom, staff: newStaff })} for ${targets.map(audience).join(", ")}`}
      </button>
    </div>
  );
}

/// The dates a change to one class covers: its own, or every week it runs — read from DCU,
/// not assumed from a week pattern.
function useSlotDates(c: DcuClass) {
  const [every, setEvery] = useState(false);
  const [dates, setDates] = useState<string[]>([c.date]);
  const [error, setError] = useState<string | null>(null);
  const [finding, find] = useTransition();

  function choose(on: boolean) {
    setEvery(on);
    setError(null);
    if (!on) { setDates([c.date]); return; }
    find(async () => {
      const res = await slotDates(c.module, c.code, c.day, c.start);
      if (res.ok) setDates(res.dates.length ? res.dates : [c.date]);
      else { setError(res.error); setEvery(false); }
    });
  }
  return { every, dates, error, finding, choose };
}

function DatesField({ c, slot }: { c: DcuClass; slot: ReturnType<typeof useSlotDates> }) {
  return (
    <div className="field">
      <label>Dates</label>
      <div className="row" style={{ alignItems: "center", gap: 12 }}>
        <label className="check"><input type="radio" checked={!slot.every} onChange={() => slot.choose(false)} /> {c.day} {shortDate(c.date)} only</label>
        <label className="check"><input type="radio" checked={slot.every} onChange={() => slot.choose(true)} /> Every week it runs</label>
        {slot.finding && <Spinner />}
      </div>
    </div>
  );
}

function DatesList({ slot }: { slot: ReturnType<typeof useSlotDates> }) {
  if (!slot.every || slot.finding) return null;
  return <p className="dim" style={{ fontSize: 12 }}>{slot.dates.length} date{slot.dates.length === 1 ? "" : "s"}: {slot.dates.map(shortDate).join(", ")}</p>;
}

function AddForm(props: Props & { onDone: () => void }) {
  const shown = props.weeks.find((w) => w.number === props.week);
  const programmes = props.programmeGroups.map((p) => p.code);
  const [module, setModule] = useState(props.modules[0]?.code ?? "");
  const [title, setTitle] = useState("");
  const [has, setHas] = useState<Set<string>>(() => new Set(programmes));
  const [group, setGroup] = useState("");
  const [first, setFirst] = useState(shown?.firstDay ?? "");
  const [repeat, setRepeat] = useState(1);
  const [startTime, setStartTime] = useState("");
  const [end, setEnd] = useState("");
  const [room, setRoom] = useState("");
  const [staff, setStaff] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();

  const dates = first ? Array.from({ length: Math.max(1, Math.min(repeat, 30)) }, (_, i) => addDays(first, 7 * i)) : [];
  const byGroup = group.trim() !== "" || !programmes.length;
  const ticked = programmes.filter((p) => has.has(p));
  // Every programme ticked is one addition for everyone, not six.
  const targets: (string | null)[] = byGroup ? groupList(group) : ticked.length === programmes.length ? [null] : ticked;
  const changes: TimetableChange[] = targets.map((g) => ({
    courseKey: props.programme, group: g, kind: "add",
    module, activityCode: null, title: title.trim() || null, dates, start: startTime,
    end: end || null, room: room.trim() || null, staff: staff.trim() || null, note: note.trim() || null,
  }));
  const problems = findingsOf(changes);

  const save = () => start(async () => {
    const res = await saveChanges(changes);
    if (res.ok) props.onDone(); else setError(res.error);
  });

  return (
    <div className="tt-edit tt-add">
      {programmes.length > 0 && (
        <ProgrammeTicks programmes={props.programmeGroups} ticked={has} disabled={group.trim() !== ""} onChange={setHas} />
      )}
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
        <div className="field" style={{ width: 190 }}>
          <label>{programmes.length ? "Or only lab groups" : "For"}</label>
          <GroupInput value={group} onChange={setGroup} groups={props.groups}
            programmes={programmes.length ? [] : props.programmeGroups}
            placeholder={programmes.length ? "C, D.1" : "Everyone"} disabled={ticked.length < programmes.length} />
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
        <div className="field" style={{ width: 180 }}>
          <label>Lecturer (optional)</label>
          <input value={staff} onChange={(e) => setStaff(e.target.value)} maxLength={120} />
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
      <button className="primary" onClick={save} disabled={saving || !changes.length || problems.some((p) => p.level === "error")}>
        {saving ? <><Spinner /> Saving</>
          : !changes.length ? "Tick the programmes that have this class"
          : `Add for ${targets.map(audience).join(", ")}`}
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

/// One box per programme of the course, ticked when the class is on its timetable. Several
/// can share a slot: the 10:00 kept for CE1 and ECE1, the 11:00 for the other four. A
/// student is on one programme, so each box is a separate change when saved.
function ProgrammeTicks({ label = "Programmes with this class", programmes, ticked, locked, disabled, onChange }: {
  label?: string;
  programmes: { code: string; name: string }[];
  ticked: Set<string>;
  /// Removed on this date already: shown unticked, and put back only under Saved changes.
  locked?: Set<string>;
  disabled?: boolean;
  onChange: (next: Set<string>) => void;
}) {
  const open = programmes.filter((p) => !locked?.has(p.code));
  const set = (codes: string[]) => onChange(new Set(codes));
  return (
    <div className="field">
      <div className="tt-who-head">
        <label>{label}</label>
        <button type="button" className="link" disabled={disabled} onClick={() => set(open.map((p) => p.code))}>All</button>
        <button type="button" className="link" disabled={disabled} onClick={() => set([])}>None</button>
      </div>
      <div className="tt-who">
        {programmes.map((p) => {
          const gone = !!locked?.has(p.code);
          return (
            <label key={p.code} className="check" title={gone ? `Already removed for ${p.code} on this date. Delete that under Saved changes to put it back.` : p.name}>
              <input type="checkbox" checked={!gone && ticked.has(p.code)} disabled={disabled || gone}
                onChange={(e) => set(open.map((x) => x.code).filter((code) => code === p.code ? e.target.checked : ticked.has(code)))} />
              <span className={gone ? "dim" : undefined}>{p.code}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

/// Free text with the known groups offered, and the course's programmes when there are no
/// boxes for them. Several, "C, D.1", saves one change for each.
function GroupInput({ value, onChange, groups, programmes, placeholder, disabled }: {
  value: string; onChange: (v: string) => void; groups: string[];
  programmes: { code: string; name: string }[]; placeholder: string; disabled?: boolean;
}) {
  return (
    <>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} list="tt-groups" disabled={disabled} />
      <datalist id="tt-groups">
        {programmes.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
        {groups.map((g) => <option key={g} value={g}>Group {g}</option>)}
      </datalist>
    </>
  );
}

/// Every change's findings, each said once: five programmes with the same missing date
/// is one problem, not five.
function findingsOf(changes: TimetableChange[]): Finding[] {
  const seen = new Set<string>();
  return changes.flatMap((c) => checkChange(c)).filter((f) => !seen.has(f.message) && !!seen.add(f.message));
}

// ---------------------------------------------------------------------------

/// The kind of class, from the letter DCU puts in the code (…OC/P1/02 is a practical) —
/// the same letters the app's activity-code parser reads (mobile/src/core/activityCode.ts). The API's own event type says "On Campus"
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
