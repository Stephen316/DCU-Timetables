import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const when = new Intl.DateTimeFormat("en-IE", {
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
});

export default async function Audit() {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("admin_actions")
    .select("id, actor_id, action, target, before, after, at")
    .order("at", { ascending: false })
    .limit(200);

  const rows = data ?? [];

  return (
    <>
      <div className="head">
        <h1>Audit</h1>
        <p>Every decision, in the order it was made. Read-only.</p>
      </div>

      {error && <div className="err">{error.message}</div>}

      {rows.length === 0 ? (
        <div className="empty">Nothing recorded yet.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Action</th>
              <th>Target</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="dim" style={{ whiteSpace: "nowrap" }}>{when.format(new Date(r.at))}</td>
                <td className="mono">{r.action}</td>
                <td className="mono dim" style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {r.target}
                </td>
                <td className="dim mono" style={{ fontSize: 12 }}>
                  {summarise(r.before)} → {summarise(r.after)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function summarise(value: unknown): string {
  if (value === null || value === undefined) return "--";
  if (typeof value !== "object") return String(value);
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== null)
    .map(([k, v]) => `${k}=${v}`);
  return entries.length ? entries.join(" ") : "--";
}
