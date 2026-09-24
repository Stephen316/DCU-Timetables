import { supabaseServer } from "@/lib/supabase/server";
import { ReviewRow } from "./row";
import { ReportedRow, type Reported } from "./reported-row";

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

  // Open reports first: App Review expects them acted on within a day. Grouped per
  // deadline, since three reports of one thing are one decision.
  const { data: reportData, error: reportError } = await supabase
    .from("deadline_reports")
    .select("reason, created_at, module_deadlines(id, module_key, title, due_at, kind, status, submitter_id)")
    .is("resolved_at", null)
    .order("created_at", { ascending: true })
    .limit(500);

  const reported = new Map<string, Reported>();
  for (const r of (reportData ?? []) as unknown as {
    reason: string; created_at: string; module_deadlines: Deadline | null;
  }[]) {
    const d = r.module_deadlines;
    if (!d) continue;
    const entry = reported.get(d.id) ?? { deadline: d, reasons: {}, first: r.created_at };
    entry.reasons[r.reason] = (entry.reasons[r.reason] ?? 0) + 1;
    reported.set(d.id, entry);
  }

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

      {reportError && <div className="err">{reportError.message}</div>}
      {reported.size > 0 && (
        <>
          <h2>Reported by students</h2>
          <table>
            <thead>
              <tr>
                <th>Module</th>
                <th>Title</th>
                <th>Reasons</th>
                <th>First reported</th>
                <th className="right">Decision</th>
              </tr>
            </thead>
            <tbody>
              {[...reported.values()].map((r) => <ReportedRow key={r.deadline.id} reported={r} />)}
            </tbody>
          </table>
          <h2>Waiting on a decision</h2>
        </>
      )}

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
