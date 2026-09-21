import { currentProfile, supabaseServer } from "@/lib/supabase/server";
import { PersonRow } from "./row";
import { GrantTrust } from "./grant";

export const dynamic = "force-dynamic";

export type Contributor = {
  id: string;
  pi: string | null;
  role: "student" | "trusted" | "admin";
  programme: string | null;
  created_at: string;
  banned_until: string | null;
  ban_reason: string | null;
  reports: number;
  deadlines: number;
  confirmations: number;
  rejected: number;
};

export default async function People() {
  const supabase = await supabaseServer();
  const me = await currentProfile();
  const { data, error } = await supabase
    .from("contributor_stats")
    .select("*")
    .order("rejected", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);

  const people = (data ?? []) as Contributor[];

  return (
    <>
      <div className="head">
        <h1>People</h1>
        <p>Accounts by their ID, never by name. Sorted so rejected submissions surface first.</p>
      </div>

      <GrantTrust />

      {error && <div className="err">{error.message}</div>}

      {people.length === 0 ? (
        <div className="empty">No accounts yet.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Role</th>
              <th>Joined</th>
              <th className="right">Reports</th>
              <th className="right">Deadlines</th>
              <th className="right">Vouches</th>
              <th className="right">Rejected</th>
              <th className="right">Action</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <PersonRow key={p.id} person={p} isMe={p.id === me?.id} />
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
