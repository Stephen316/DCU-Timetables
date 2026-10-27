import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Accounts for trying the app as a student. The passwords live only in the database
 * (supabase/phase31_test_accounts.sql explains why), never in this repo, which is public.
 */
export default async function TestAccounts() {
  const db = await supabaseServer();
  const { data, error } = await db.rpc("list_test_accounts");
  const accounts = (data ?? []) as { email: string; password: string }[];

  return (
    <>
      <div className="head">
        <h1>Test accounts</h1>
        <p>Sign in to the app as any of these to see it as a student would.</p>
      </div>

      {error && <div className="err">{error.message}</div>}

      {accounts.length === 0 ? (
        <div className="empty">No test accounts yet.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Password</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.email}>
                <td className="mono">{a.email}</td>
                <td className="mono">{a.password}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
