import { supabaseServer } from "@/lib/supabase/server";
import { courses } from "@/lib/abbreviations/modules";
import type { Entry } from "@/lib/abbreviations/check";
import { Editor } from "./editor";

/// What each module is called on the app's week grid, course by course. Typed here, or
/// suggested in bulk by the assistant and saved after a look.
export default async function AbbreviationsPage() {
  const db = await supabaseServer();
  const [list, { data, error }] = await Promise.all([
    courses(),
    db.from("module_abbreviations").select("module_key, abbreviation, source, flag, suggestion"),
  ]);
  const saved: Record<string, Entry> = Object.fromEntries((data ?? []).map((r) => [
    r.module_key,
    { abbreviation: r.abbreviation, source: r.source, flag: r.flag, suggestion: r.suggestion },
  ]));

  return (
    <>
      <div className="head">
        <h1>Abbreviations</h1>
        <p>
          What each module is called on the app&rsquo;s week grid. A module left empty shows DCU&rsquo;s name, shortened
          by the app. Module codes are taken off DCU&rsquo;s names before they reach this page or the assistant. Phones
          pick up changes when the app opens, and every 15 minutes while it&rsquo;s open.
        </p>
      </div>
      {error && (
        <p className="err">
          {error.message}
          {/relation|schema cache/i.test(error.message) && " Run supabase/phase28_module_abbreviations.sql first."}
        </p>
      )}
      <Editor courses={list} saved={saved} />
    </>
  );
}
