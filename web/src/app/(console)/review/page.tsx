import { supabaseServer } from "@/lib/supabase/server";
import { ReviewRow } from "./row";

export const dynamic = "force-dynamic";

type Deadline = {
  id: string;
  module_key: string;
  title: string;
  due_at: string;
  kind: string;
  status: string;
  submitted_at: string;
  submitter_id: string;
};

export default async function Review() {
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from("module_deadlines")
    .select("id, module_key, title, due_at, kind, status, submitted_at, submitter_id")
    .eq("status", "pending")
    .order("submitted_at", { ascending: false })
    .limit(200);

  const rows = (data ?? []) as Deadline[];

  // Confirmations are counted here rather than joined, because PostgREST cannot aggregate
  // a child table in a select. One extra query for the whole page is cheaper than the
  // view it would otherwise need.
  const ids = rows.map((r) => r.id);
  const counts = new Map<string, number>();
  if (ids.length) {
    const { data: confirmations } = await supabase
      .from("deadline_confirmations")
      .select("deadline_id")
      .in("deadline_id", ids);
    for (const c of confirmations ?? []) {
      counts.set(c.deadline_id, (counts.get(c.deadline_id) ?? 0) + 1);
    }
  }

  return (
    <>
      <div className="head">
        <h1>Review queue</h1>
        <p>Deadlines students have shared, waiting on a decision.</p>
      </div>

      {error && <div className="err">{error.message}</div>}

      {rows.length === 0 ? (
        <div className="empty">Nothing waiting. Verified and rejected deadlines stay out of this list.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Module</th>
              <th>Title</th>
              <th>Due</th>
              <th>Kind</th>
              <th className="right">Vouched</th>
              <th className="right">Decision</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <ReviewRow key={d.id} deadline={d} confirmations={counts.get(d.id) ?? 0} />
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
