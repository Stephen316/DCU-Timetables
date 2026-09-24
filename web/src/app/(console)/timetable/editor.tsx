"use client";

import { useState, useTransition } from "react";
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

/// A row of the week: one of DCU's classes, or one a change adds.
type Row =
  | { from: "dcu"; c: DcuClass; removedFor: SavedChange[] }
  | { from: "added"; change: SavedChange; date: string };

export function Editor(props: Props) {
  const { programme, weeks, week, classes, changes } = props;
  const router = useRouter();
  const [removing, setRemoving] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const go = (p: string, w: number | null) =>
    router.push(`/timetable?programme=${encodeURIComponent(p)}${w ? `&week=${w}` : ""}`);

  const shown = weeks.find((w) => w.number === week);
  const inWeek = (date: string) => !!shown && date >= shown.firstDay && date < addDays(shown.firstDay, 7);

  const rows: Row[] = [
    ...classes.map((c): Row => ({
      from: "dcu", c,
      removedFor: changes.filter((x) => x.kind === "remove" && x.module === c.module && x.start === c.start &&
        x.dates.includes(c.date) && (!x.activityCode || x.activityCode === c.code)),
    })),
    ...changes.filter((x) => x.kind === "add").flatMap((x) =>
      x.dates.filter(inWeek).map((date): Row => ({ from: "added", change: x, date }))),
  ].sort((a, b) => key(a).localeCompare(key(b)));

  const idx = weeks.findIndex((w) => w.number === week);

  return (
    <>
      <div className="row" style={{ marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
        <select value={programme} onChange={(e) => go(e.target.value, week)} style={{ width: "auto" }}>
          {props.programmes.map((p) => <option key={p.key} value={p.key}>{p.key} · {p.name}</option>)}
        </select>
        <button type="button" disabled={idx <= 0} onClick={() => go(programme, weeks[idx - 1].number)} aria-label="Previous week">‹</button>
        <select value={week ?? ""} onChange={(e) => go(programme, Number(e.target.value))} style={{ width: "auto" }}>
          {weeks.map((w) => <option key={w.number} value={w.number}>Week {w.label} · {w.firstDay}</option>)}
        </select>
        <button type="button" disabled={idx < 0 || idx >= weeks.length - 1} onClick={() => go(programme, weeks[idx + 1].number)} aria-label="Next week">›</button>
        <button type="button" style={{ marginLeft: "auto" }} onClick={() => setAdding((a) => !a)}>
          {adding ? "Close" : "Add a class"}
        </button>
      </div>

      {adding && <AddForm {...props} onDone={() => setAdding(false)} />}

      {rows.length === 0 ? (
        <div className="empty">No classes this week.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="tt">
            <thead>
              <tr><th>Day</th><th>Time</th><th>Module</th><th>Activity</th><th>Room</th><th>Changes</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((r) => r.from === "dcu" ? (
                <DcuRow key={`${r.c.code}|${r.c.date}|${r.c.start}`} r={r} props={props}
                  open={removing === `${r.c.code}|${r.c.date}|${r.c.start}`}
                  onToggle={() => setRemoving((x) => x === `${r.c.code}|${r.c.date}|${r.c.start}` ? null : `${r.c.code}|${r.c.date}|${r.c.start}`)} />
              ) : (
                <tr key={`add|${r.change.id}|${r.date}`} className="tt-added">
                  <td>{weekday(r.date)} <span className="dim">{r.date.slice(5)}</span></td>
                  <td className="mono">{r.change.start}–{r.change.end}</td>
                  <td className="mono">{r.change.module}</td>
                  <td>{r.change.title}</td>
                  <td className="mono">{r.change.room ?? <span className="dim">—</span>}</td>
                  <td><span className="tag ok">added · {r.change.group ?? "everyone"}</span></td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Saved changes={changes} />
    </>
  );
}

function DcuRow({ r, props, open, onToggle }: {
  r: Extract<Row, { from: "dcu" }>; props: Props; open: boolean; onToggle: () => void;
}) {
  const { c } = r;
  const everyone = r.removedFor.some((x) => !x.group);
  return (
    <>
      <tr className={everyone ? "tt-removed" : undefined}>
        <td>{c.day} <span className="dim">{c.date.slice(5)}</span></td>
        <td className="mono">{c.start}–{c.end}</td>
        <td className="mono">{c.module}</td>
        <td><span className="mono">{c.code.split("/").slice(1).join("/") || c.code}</span> <span className="dim">{c.kind}</span></td>
        <td className="mono">{c.rooms.join(", ") || <span className="dim">—</span>}</td>
        <td>
          {r.removedFor.map((x) => (
            <span key={x.id} className="tag off" style={{ marginRight: 6 }}>removed · {x.group ?? "everyone"}</span>
          ))}
        </td>
        <td className="right"><button type="button" onClick={onToggle}>{open ? "Cancel" : "Remove…"}</button></td>
      </tr>
      {open && (
        <tr className="tt-form">
          <td colSpan={7}><RemoveForm c={c} props={props} onDone={onToggle} /></td>
        </tr>
      )}
    </>
  );
}

function RemoveForm({ c, props, onDone }: { c: DcuClass; props: Props; onDone: () => void }) {
  const router = useRouter();
  const [group, setGroup] = useState("");
  const [every, setEvery] = useState(false);
  const [dates, setDates] = useState<string[]>([c.date]);
  const [onlyThis, setOnlyThis] = useState(true);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, start] = useTransition();

  async function chooseEvery(on: boolean) {
    setEvery(on);
    setError(null);
    if (!on) { setDates([c.date]); return; }
    setLoading(true);
    const res = await slotDates(c.module, c.code, c.day, c.start);
    setLoading(false);
    if (res.ok) setDates(res.dates.length ? res.dates : [c.date]);
    else { setError(res.error); setEvery(false); }
  }

  const change: TimetableChange = {
    courseKey: props.programme, group: group.trim().toUpperCase() || null, kind: "remove",
    module: c.module, activityCode: onlyThis ? c.code : null, title: null,
    dates, start: c.start, end: null, room: null, note: note.trim() || null,
  };
  const problems = checkChange(change);

  function save() {
    start(async () => {
      const res = await saveChange(change);
      if (res.ok) { onDone(); router.refresh(); } else setError(res.error);
    });
  }

  return (
    <div className="tt-edit">
      <div className="row" style={{ flexWrap: "wrap" }}>
        <div className="field" style={{ width: 140 }}>
          <label>For</label>
          <GroupInput value={group} onChange={setGroup} groups={props.groups} />
        </div>
        <div className="field">
          <label>Dates</label>
          <div className="row" style={{ alignItems: "center", gap: 12 }}>
            <label className="check"><input type="radio" checked={!every} onChange={() => chooseEvery(false)} /> {c.day} {c.date} only</label>
            <label className="check"><input type="radio" checked={every} onChange={() => chooseEvery(true)} /> Every week it runs</label>
            {loading && <Spinner />}
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
      {every && !loading && <p className="dim" style={{ fontSize: 12 }}>{dates.length} date{dates.length === 1 ? "" : "s"}: {dates.map((d) => d.slice(5)).join(", ")}</p>}
      {problems.map((p, i) => <p key={i} className={p.level === "error" ? "tag off" : "tag warn"}>{p.message}</p>)}
      {error && <p className="err">{error}</p>}
      <button className="primary" onClick={save} disabled={saving || loading || problems.some((p) => p.level === "error")}>
        {saving ? <><Spinner /> Saving</> : `Remove for ${change.group ?? "everyone"}`}
      </button>
    </div>
  );
}

function AddForm(props: Props & { onDone: () => void }) {
  const router = useRouter();
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

  function save() {
    start(async () => {
      const res = await saveChange(change);
      if (res.ok) { props.onDone(); router.refresh(); } else setError(res.error);
    });
  }

  return (
    <div className="tt-edit" style={{ border: "1px solid var(--border)", borderRadius: 8, marginBottom: 16 }}>
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
        <p className="dim" style={{ fontSize: 12 }}>{dates.map((d) => `${weekday(d)} ${d.slice(5)}`).join(", ")}</p>
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
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(id: string) {
    setBusy(id);
    setError(null);
    const res = await deleteChange(id);
    setBusy(null);
    if (res.ok) router.refresh(); else setError(res.error);
  }

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
                <td className="dim" style={{ maxWidth: 320 }}>{c.dates.map((d) => d.slice(5)).join(", ")}</td>
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

function key(r: Row): string {
  return r.from === "dcu" ? `${r.c.date}${r.c.start}${r.c.code}` : `${r.date}${r.change.start}${r.change.module}`;
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
