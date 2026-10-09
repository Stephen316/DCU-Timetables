import { supabaseServer } from "@/lib/supabase/server";
import { PROGRAMMES, programmeFor } from "@/lib/proposals/courses";
import { classes, weeks, type DcuClass, type Week } from "@/lib/dcu/timetable";
import { fromRow, type SavedChange } from "@/lib/changes/change";
import { stripModuleCode } from "@/lib/abbreviations/names";
import type { Entry } from "@/lib/abbreviations/check";
import { Editor } from "./editor";

/// A programme's week as DCU publishes it, with the changes saved on top: what is removed,
/// for whom, what is added, and what has a new room or lecturer. Changes are made here
/// directly or proposed from Ask. A class also leads to its module's name on the app's week
/// grid, which is the module's everywhere.
export default async function TimetablePage({ searchParams }: {
  searchParams: Promise<{ programme?: string; week?: string }>;
}) {
  const params = await searchParams;
  const programme = programmeFor(params.programme ?? "") ?? PROGRAMMES[0];
  const db = await supabaseServer();

  let all: Week[] = [];
  let found: DcuClass[] = [];
  let failed: string | null = null;
  let week: Week | undefined;
  try {
    all = await weeks();
    week = all.find((w) => String(w.number) === params.week) ?? current(all);
    if (week) found = await classes(programme.modules.map((m) => m.code), [week.number]);
  } catch (e) {
    failed = e instanceof Error ? e.message : "Couldn't reach DCU's timetable.";
  }

  const [{ data: changeRows, error }, { data: rotation }, { data: allocations }, { data: abbreviationRows }] = await Promise.all([
    db.from("timetable_changes").select("*").eq("course_key", programme.key).order("created_at"),
    db.from("lab_rotations").select("lab_rotation_sessions(groups)").eq("course_key", programme.key).maybeSingle(),
    db.from("course_allocations").select("grp, subgroup").eq("course_key", programme.key),
    // Every module's, not only this course's: a handful of rows, and two modules anywhere
    // that read the same on the grid is worth a warning.
    db.from("module_abbreviations").select("module_key, abbreviation, source, flag, suggestion"),
  ]);
  const abbreviations: Record<string, Entry> = Object.fromEntries((abbreviationRows ?? []).map((r) => [
    r.module_key, { abbreviation: r.abbreviation, source: r.source, flag: r.flag, suggestion: r.suggestion },
  ]));
  // DCU's names with the codes taken off, as the admin and the assistant see them: this
  // week's classes', then the course's own list for the rest.
  const moduleNames: Record<string, string> = Object.fromEntries(programme.modules.map((m) => [m.code, m.title]));
  for (const c of found) if (c.title) moduleNames[c.module] = stripModuleCode(c.title, c.module) || moduleNames[c.module] || "";
  const changes: SavedChange[] = (changeRows ?? []).map(fromRow);

  // The groups the console already knows for this course, offered as suggestions. Any
  // letter can still be typed: a course may have groups nothing here has recorded.
  const groups = [...new Set([
    ...((rotation?.lab_rotation_sessions ?? []) as { groups: string[] | null }[]).flatMap((s) => s.groups ?? []),
    ...(allocations ?? []).flatMap((a) => [a.grp, a.subgroup].filter(Boolean) as string[]),
  ])].sort();

  return (
    <>
      <div className="head">
        <h1>Timetable</h1>
        <p>
          DCU&rsquo;s classes for a programme, with removals, additions and new rooms or lecturers for any of its
          programmes, a lab group, or everyone. Pick a class to change it, or to name its module on the app&rsquo;s week
          grid. Phones pick changes up when the app opens or comes back to the front.
        </p>
      </div>
      {error && <p className="err">{error.message}</p>}
      {failed && <p className="err">{failed}</p>}
      <Editor
        programmes={PROGRAMMES.map((p) => ({ key: p.key, name: p.name }))}
        programme={programme.key}
        modules={programme.modules.map((m) => ({ code: m.code, title: m.title }))}
        weeks={all}
        week={week?.number ?? null}
        classes={found}
        changes={changes}
        groups={groups}
        programmeGroups={programme.covers.map((c) => ({ code: c.code, name: c.name }))}
        abbreviations={abbreviations}
        moduleNames={moduleNames}
      />
    </>
  );
}

/// The week containing today, or the first week if the year hasn't started.
function current(all: Week[]): Week | undefined {
  const today = new Date().toISOString().slice(0, 10);
  return [...all].reverse().find((w) => w.firstDay <= today) ?? all[0];
}
