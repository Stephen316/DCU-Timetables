import { supabaseServer } from "@/lib/supabase/server";
import { PROGRAMMES } from "@/lib/proposals/courses";
import { ResolveFlag } from "./resolve";

export const dynamic = "force-dynamic";

type Flag = {
  id: number;
  course_key: string;
  pi: string | null;
  reason: string;
  created_at: string;
  resolved_at: string | null;
};

const when = new Intl.DateTimeFormat("en-IE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/// resolve_allocation's two reasons, in the words an admin would use. An unknown reason is
/// shown as the server wrote it.
const REASONS: Record<string, string> = {
  "name matched, student ID did not": "Their name is on the class list, with a different student ID",
  "student ID matched a row under another name": "Their student ID is on the class list, under another name",
};

function programme(key: string): string {
  return PROGRAMMES.find((p) => p.key === key)?.name ?? key;
}

export default async function Flags() {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("allocation_flag_list");
  const flags = (data ?? []) as Flag[];
  const open = flags.filter((f) => f.resolved_at === null);
  const resolved = flags.filter((f) => f.resolved_at !== null);
  // PostgREST's "no such function": the phase that adds it hasn't been run yet.
  const missing = error?.code === "PGRST202";

  return (
    <>
      <div className="head">
        <h1>Flags</h1>
        <p>
          Students whose name and student ID disagree with a class list. Each keeps the
          programme&apos;s general timetable until it&apos;s sorted out. Accounts by their ID,
          never by name.
        </p>
      </div>

      {missing ? (
        <div className="err">Run supabase/phase41_allocation_flags.sql in the SQL editor first.</div>
      ) : (
        error && <div className="err">{error.message}</div>
      )}

      {!error && open.length === 0 && <div className="empty">No open flags.</div>}

      {open.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Raised</th>
              <th>ID</th>
              <th>Class list</th>
              <th>What disagrees</th>
              <th className="right">Action</th>
            </tr>
          </thead>
          <tbody>
            {open.map((f) => (
              <tr key={f.id}>
                <td className="dim" style={{ whiteSpace: "nowrap" }}>{when.format(new Date(f.created_at))}</td>
                <td className="mono">{f.pi ?? "--"}</td>
                <td>{programme(f.course_key)}</td>
                <td>{REASONS[f.reason] ?? f.reason}</td>
                <td className="right"><ResolveFlag id={f.id} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 style={{ marginTop: 28 }}>Sorting one out</h2>
      <ul className="dim" style={{ fontSize: 13, lineHeight: 1.7, paddingLeft: 18, maxWidth: 640 }}>
        <li>
          If the class list is wrong, correct it and upload it again in Ask. Each student on it
          is checked again the next time their app opens.
        </li>
        <li>
          If the student typed the wrong student ID, it can only be changed in Supabase for now,
          and the app keeps the ID it saved, so they need to sign out and in again.
        </li>
        <li>
          Mark resolved once it&apos;s fixed. If the two still disagree, the student&apos;s next
          check raises a new flag.
        </li>
      </ul>

      {resolved.length > 0 && (
        <>
          <h2 style={{ marginTop: 28 }}>Resolved in the last 30 days</h2>
          <table>
            <thead>
              <tr>
                <th>Raised</th>
                <th>ID</th>
                <th>Class list</th>
                <th>What disagreed</th>
                <th className="right">Resolved</th>
              </tr>
            </thead>
            <tbody>
              {resolved.map((f) => (
                <tr key={f.id} className="dim">
                  <td style={{ whiteSpace: "nowrap" }}>{when.format(new Date(f.created_at))}</td>
                  <td className="mono">{f.pi ?? "--"}</td>
                  <td>{programme(f.course_key)}</td>
                  <td>{REASONS[f.reason] ?? f.reason}</td>
                  <td className="right" style={{ whiteSpace: "nowrap" }}>{when.format(new Date(f.resolved_at!))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
