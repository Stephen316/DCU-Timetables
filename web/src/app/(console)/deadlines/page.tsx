import { supabaseServer } from "@/lib/supabase/server";
import { DeadlineRow, type ConsoleDeadline, type DetailsVersion } from "./row";

export const dynamic = "force-dynamic";

const STATUSES = { all: "Any state", pending: "Waiting", verified: "Confirmed", rejected: "Blocked" } as const;
const WHEN = { upcoming: "Upcoming", past: "Past", all: "Any date" } as const;
type Status = keyof typeof STATUSES;
type When = keyof typeof WHEN;

// Submitter ids of deleted accounts are a fixed stand-in, not a profile, so only real ids
// are looked up.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Deadlines({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; when?: string; q?: string }>;
}) {
  const params = await searchParams;
  const status: Status = params.status && params.status in STATUSES ? (params.status as Status) : "all";
  const when: When = params.when && params.when in WHEN ? (params.when as When) : "upcoming";
  // Commas and brackets are PostgREST's own syntax inside `or=`, so they can't be searched for.
  const q = (params.q ?? "").replace(/[,()%*\\]/g, " ").trim();

  const supabase = await supabaseServer();
  let query = supabase
    .from("module_deadlines")
    .select("id, module_key, title, due_at, kind, grade_weight, status, source, submitted_at, edited_at, submitter_id, details, details_edited_at, details_edited_by")
    .limit(300);
  if (status !== "all") query = query.eq("status", status);
  // From the start of today, as the app lists them: a 9am hand-in stays upcoming all day.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (when === "upcoming") query = query.gte("due_at", today.toISOString()).order("due_at", { ascending: true });
  else if (when === "past") query = query.lt("due_at", today.toISOString()).order("due_at", { ascending: false });
  else query = query.order("due_at", { ascending: false });
  if (q) query = query.or(`module_key.ilike.*${q}*,title.ilike.*${q}*`);

  const { data, error } = await query;
  const rows = (data ?? []) as Omit<ConsoleDeadline, "confirmations" | "disputes" | "reports" | "detailReports" | "poster" | "detailsEditor" | "history">[];
  const ids = rows.map((r) => r.id);

  // Counted here, as on the review page: PostgREST can't aggregate a child table in a select.
  const confirmations = new Map<string, number>();
  const disputes = new Map<string, number>();
  const reports = new Map<string, number>();
  const detailReports = new Map<string, number>();
  const posters = new Map<string, string | null>();
  const history = new Map<string, DetailsVersion[]>();
  if (ids.length) {
    const [{ data: c }, { data: r }, { data: h }] = await Promise.all([
      supabase.from("deadline_confirmations").select("deadline_id").in("deadline_id", ids),
      supabase.from("deadline_reports").select("deadline_id, reason").in("deadline_id", ids).is("resolved_at", null),
      // Newest first: the version just replaced is the one a vandalised box wants back.
      supabase.from("deadline_details_history")
        .select("deadline_id, details, written_by, written_at, replaced_by, replaced_at")
        .in("deadline_id", ids).order("replaced_at", { ascending: false }).limit(1000),
    ]);
    for (const row of c ?? []) confirmations.set(row.deadline_id, (confirmations.get(row.deadline_id) ?? 0) + 1);
    for (const row of r ?? []) {
      const into = row.reason === "wrong" ? disputes : row.reason === "details" ? detailReports : reports;
      into.set(row.deadline_id, (into.get(row.deadline_id) ?? 0) + 1);
    }
    // Who wrote each version is looked up the same way as who posted the deadline.
    const people = new Set<string>(rows.map((r) => r.submitter_id));
    for (const r of rows) if (r.details_edited_by) people.add(r.details_edited_by);
    for (const v of h ?? []) {
      if (v.written_by) people.add(v.written_by);
      if (v.replaced_by) people.add(v.replaced_by);
    }
    const lookup = [...people].filter((id) => UUID.test(id));
    if (lookup.length) {
      const { data: found } = await supabase.from("contributor_stats").select("id, pi").in("id", lookup);
      for (const p of found ?? []) posters.set(p.id, p.pi);
    }
    for (const v of h ?? []) {
      const list = history.get(v.deadline_id) ?? [];
      list.push({
        details: v.details,
        written_at: v.written_at,
        writer: v.written_by ? posters.get(v.written_by) ?? null : null,
        replaced_at: v.replaced_at,
        replacer: v.replaced_by ? posters.get(v.replaced_by) ?? null : null,
      });
      history.set(v.deadline_id, list);
    }
  }

  const deadlines: ConsoleDeadline[] = rows.map((r) => ({
    ...r,
    confirmations: confirmations.get(r.id) ?? 0,
    disputes: disputes.get(r.id) ?? 0,
    reports: reports.get(r.id) ?? 0,
    detailReports: detailReports.get(r.id) ?? 0,
    poster: posters.get(r.submitter_id) ?? null,
    detailsEditor: r.details_edited_by ? posters.get(r.details_edited_by) ?? null : null,
    history: history.get(r.id) ?? [],
  }));
  const waiting = deadlines.filter((d) => d.status === "pending").length;
  const disputed = deadlines.filter((d) => d.disputes > 0 && d.disputes >= d.confirmations).length;

  return (
    <>
      <div className="head">
        <h1>Deadlines</h1>
        <p>
          Every deadline students have shared, whatever its state. Confirm puts a moderator&apos;s name
          behind it; block takes it down and catches the same title on the same day if it&apos;s posted
          again; remove deletes it outright. Any student can edit a deadline&apos;s details, so each
          keeps its earlier versions, and who wrote them, under History.
        </p>
      </div>

      <form method="get" className="row" style={{ marginBottom: 16 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="status">State</label>
          <select id="status" name="status" defaultValue={status}>
            {Object.entries(STATUSES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="when">Due</label>
          <select id="when" name="when" defaultValue={when}>
            {Object.entries(WHEN).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0, flex: 1 }}>
          <label htmlFor="q">Module or title</label>
          <input id="q" name="q" defaultValue={q} placeholder="CA106, quiz…" />
        </div>
        <button type="submit">Filter</button>
      </form>

      {error && <div className="err">{error.message}</div>}

      {deadlines.length === 0 ? (
        <div className="empty">No deadlines match.</div>
      ) : (
        <>
          <p className="dim" style={{ fontSize: 12 }}>
            {deadlines.length}{deadlines.length === 300 ? "+" : ""} shown · {waiting} waiting · {disputed} disputed
          </p>
          <table>
            <thead>
              <tr>
                <th>Module</th>
                <th>Title</th>
                <th>Due</th>
                <th>Kind</th>
                <th className="right" title="Share of the module's grade">Worth</th>
                <th>State</th>
                <th className="right" title="Students who confirmed it">Right</th>
                <th className="right" title="Students who say the date or details are wrong">Wrong</th>
                <th className="right" title="Open reports: offensive, spam or other">Reports</th>
                <th>Poster</th>
                <th className="right">Decision</th>
              </tr>
            </thead>
            <tbody>
              {deadlines.map((d) => <DeadlineRow key={d.id} deadline={d} />)}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
