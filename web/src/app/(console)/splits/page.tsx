import { SplitChat } from "./chat";
import { supabaseServer } from "@/lib/supabase/server";

export default async function SplitsPage() {
  const configured = Boolean(process.env.GEMINI_API_KEY);
  const { data: existing } = await (await supabaseServer())
    .from("module_splits")
    .select("module_key, activity, created_at, module_split_ranges(from_letter, to_letter, day, start_time)")
    .order("module_key");

  return (
    <>
      <div className="head">
        <h1>Splits</h1>
        <p>
          Modules where surname decides which session you attend. Describe the rule in plain
          English; nothing is saved until you accept it.
        </p>
      </div>

      {configured ? (
        <SplitChat />
      ) : (
        <div className="empty">
          <p style={{ color: "var(--off)" }}>GEMINI_API_KEY is not set.</p>
          <p>Add it to <span className="mono">web/.env.local</span> and restart the dev server.</p>
        </div>
      )}

      {existing && existing.length > 0 && (
        <>
          <div className="head" style={{ marginTop: 32, marginBottom: 12 }}>
            <h2 style={{ marginBottom: 0 }}>Saved</h2>
          </div>
          <table>
            <thead>
              <tr><th>Module</th><th>Activity</th><th>Bands</th></tr>
            </thead>
            <tbody>
              {existing.map((s) => (
                <tr key={`${s.module_key}-${s.activity}`}>
                  <td className="mono">{s.module_key}</td>
                  <td>{s.activity}</td>
                  <td className="dim">
                    {s.module_split_ranges
                      .map((r) => `${r.from_letter}–${r.to_letter} ${r.day} ${r.start_time}`)
                      .join("  ·  ")}
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
