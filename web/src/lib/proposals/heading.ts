// A module's heading in the app — what the day view, the widget and the deadlines list call
// it in place of DCU's "EEG1000[1,2] Fundamentals of Professional Development". Pure checks,
// no I/O, so the harness can run them.

import type { Finding } from "@/lib/extraction/rotation";

/// `title` null puts DCU's name back. The week grid's shorter names are set on the
/// Abbreviations page, not here.
export type Heading = { moduleKey: string; title: string | null };

/// The limit `supabase/phase27_module_titles.sql` enforces, checked here first so the panel
/// says why rather than the save failing on a constraint.
export const TITLE_LIMIT = 80;

export function checkHeading(h: Heading): Finding[] {
  const out: Finding[] = [];
  if (!h.moduleKey) out.push({ level: "error", message: "Pick the module this heading is for." });
  if (h.title !== null && !h.title.trim()) out.push({ level: "error", message: "The heading is empty." });
  if (h.title && h.title.length > TITLE_LIMIT) {
    out.push({ level: "error", message: `The heading is ${h.title.length} characters; it can be at most ${TITLE_LIMIT}.` });
  }
  // A one-hour week-grid block shows about 20 characters (lib/abbreviations/check.ts).
  if (h.title && h.title.length > 20) {
    out.push({
      level: "info",
      message: "Long for the week grid, where the app shortens it unless the module has an abbreviation. Set one on the Abbreviations page to choose the words there.",
    });
  }
  return out;
}

/// A heading is words for students to read, so it has to be the administrator's words — not
/// the model's paraphrase of them. It must appear in what was said, ignoring case and spacing.
export function checkHeadingProvenance(h: Heading, source: string): Finding[] {
  if (!h.title || squash(source).includes(squash(h.title))) return [];
  return [{
    level: "error",
    message: `“${h.title}” isn't in what you wrote, so it's the assistant's wording. Say the exact heading you want.`,
  }];
}

function squash(text: string): string {
  return text.toLowerCase().replace(/[\s“”"'‘’]+/g, "");
}

export function describeHeading(h: Heading): string {
  return h.title === null ? `${h.moduleKey} back to DCU's name` : `${h.moduleKey} heading “${h.title}”`;
}
