import { supabaseServer } from "@/lib/supabase/server";

/// The read side. Everything on this page was written from Ask, and nothing here proposes
/// anything — a list is a bad conversation and a conversation is a bad list.
export default async function CoursesPage() {
  const db = await supabaseServer();
  const [{ data: splits }, { data: rotations }] = await Promise.all([
    db.from("module_splits")
      .select("module_key, activity, created_at, module_split_ranges(from_letter, to_letter, day, start_time, end_time, room)")
      .order("module_key"),
    db.from("lab_rotations")
      .select("course_key, title, version, created_at, lab_rotation_sessions(id)")
      .order("course_key"),
  ]);

  const nothing = !splits?.length && !rotations?.length;

  return (
    <>
      <div className="head">
        <h1>Courses</h1>
        <p>What the app will serve. Add to it from Ask.</p>
      </div>

      {nothing && <div className="empty">Nothing saved yet.</div>}

      {rotations && rotations.length > 0 && (
        <>
          <h2 style={{ marginTop: 8 }}>Lab rotations</h2>
          <table style={{ marginBottom: 28 }}>
            <thead>
              <tr><th>Course</th><th>Title</th><th>Sessions</th><th className="right">Version</th></tr>
            </thead>
            <tbody>
              {rotations.map((r) => (
                <tr key={r.course_key}>
                  <td className="mono">{r.course_key}</td>
                  <td>{r.title ?? <span className="dim">—</span>}</td>
                  <td>{r.lab_rotation_sessions.length}</td>
                  <td className="right dim">v{r.version}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {splits && splits.length > 0 && (
        <>
          <h2>Alphabetical splits</h2>
          <table>
            <thead>
              <tr><th>Module</th><th>Activity</th><th>Bands</th></tr>
            </thead>
            <tbody>
              {splits.map((s) => (
                <tr key={`${s.module_key}-${s.activity}`}>
                  <td className="mono">{s.module_key}</td>
                  <td>{s.activity}</td>
                  <td className="dim">
                    {s.module_split_ranges
                      .map((r) => `${r.from_letter}–${r.to_letter} ${r.day} ${r.start_time}${r.room ? ` ${r.room}` : ""}`)
                      .join("   ·   ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
