"use server";

import { revalidatePath } from "next/cache";
import { consoleOpen } from "@/lib/auth/gate";
import { supabaseServer } from "@/lib/supabase/server";
import { mistralKey, MISTRAL_MODEL } from "@/lib/mistral/client";
import { classify } from "@/lib/mistral/api";
import { suggestAbbreviations, type Suggestion } from "@/lib/mistral/abbreviate";
import { entryProblem, normalEntry, type Entry } from "@/lib/abbreviations/check";
import { course } from "@/lib/abbreviations/modules";
import { programmeFor } from "@/lib/proposals/courses";

// A Server Action is reachable by POST without the page that hosts it, so each checks.
const NOT_ALLOWED = "The console is locked, or this account isn't an admin.";

/// The assistant's abbreviations for every module of a course that no one has set by hand.
/// Nothing is saved: the page shows them as unsaved changes to look over first.
export async function suggest(courseKey: string):
  Promise<{ ok: true; suggestions: Suggestion[]; skipped: number } | { ok: false; error: string }> {
  if (!(await consoleOpen())) return { ok: false, error: NOT_ALLOWED };
  const programme = programmeFor(courseKey);
  if (!programme) return { ok: false, error: `There's no course ${courseKey}.` };

  const { modules } = await course(programme);
  const db = await supabaseServer();
  const { data, error } = await db.from("module_abbreviations")
    .select("module_key, abbreviation, source")
    .in("module_key", modules.map((m) => m.code));
  if (error) return { ok: false, error: error.message };
  const manual = new Map((data ?? []).filter((r) => r.source === "manual").map((r) => [r.module_key, r.abbreviation as string]));

  const targets = modules.filter((m) => !manual.has(m.code));
  if (!targets.length) return { ok: true, suggestions: [], skipped: manual.size };
  try {
    const out = await suggestAbbreviations({
      key: mistralKey(),
      modules: targets,
      // What people set stays, so a suggestion that reads the same as one of those is flagged.
      others: modules.filter((m) => manual.has(m.code)).map((m) => ({ ...m, abbreviation: manual.get(m.code)! })),
      model: MISTRAL_MODEL,
    });
    return { ok: true, suggestions: out.suggestions, skipped: manual.size };
  } catch (e) {
    return { ok: false, error: classify(e).message };
  }
}

/// All or none: a half-saved batch would leave the page's unsaved rows out of step with what
/// the app has. The definer function checks the caller is an admin and audits each module.
export async function save(edits: { code: string; entry: Entry }[]):
  Promise<{ ok: true; changed: number } | { ok: false; error: string }> {
  if (!(await consoleOpen())) return { ok: false, error: NOT_ALLOWED };
  if (!edits.length) return { ok: false, error: "Nothing to save." };
  if (edits.length > 500) return { ok: false, error: "Save at most 500 modules at a time." };

  const rows = edits.map(({ code, entry }) => ({ module_key: code, ...normalEntry(entry) }));
  for (const r of rows) {
    const problem = entryProblem(r.module_key, r);
    if (problem) return { ok: false, error: `${r.module_key}: ${problem}` };
  }

  const db = await supabaseServer();
  const { data, error } = await db.rpc("save_module_abbreviations", { p_rows: rows });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/abbreviations");
  return { ok: true, changed: Number(data ?? 0) };
}
