import { supabaseServer } from "@/lib/supabase/server";
import { PROGRAMMES, programmeFor } from "@/lib/proposals/courses";
import { classes, weeks, type DcuClass, type Week } from "@/lib/dcu/timetable";
import { fromRow, type SavedChange } from "@/lib/changes/change";
import { Editor } from "./editor";

/// A programme's week as DCU publishes it, with the changes saved on top: what is removed,
/// for whom, and what is added. Changes are made here directly or proposed from Ask.
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

  const [{ data: changeRows, error }, { data: rotation }, { data: allocations }] = await Promise.all([
    db.from("timetable_changes").select("*").eq("course_key", programme.key).order("created_at"),
    db.from("lab_rotations").select("lab_rotation_sessions(groups)").eq("course_key", programme.key).maybeSingle(),
    db.from("course_allocations").select("grp, subgroup").eq("course_key", programme.key),
  ]);
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
        <p>DCU&rsquo;s classes for a programme, with removals and additions for a lab group, one of its programmes, or everyone. Phones pick changes up when the app opens.</p>
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
      />
    </>
  );
}

/// The week containing today, or the first week if the year hasn't started.
function current(all: Week[]): Week | undefined {
  const today = new Date().toISOString().slice(0, 10);
  return [...all].reverse().find((w) => w.firstDay <= today) ?? all[0];
}
