// A module's heading in the app — what the day view, the widget and the deadlines list call
// it in place of DCU's "EEG1000[1,2] Fundamentals of Professional Development". Pure checks,
// no I/O, so the harness can run them.

import type { Finding } from "@/lib/extraction/rotation";

/// `title` null puts DCU's name back. `shortTitle` is what the narrow week-grid block shows;
/// null leaves the app to shorten `title` itself.
export type Heading = { moduleKey: string; title: string | null; shortTitle: string | null };

/// The limits `supabase/phase27_module_titles.sql` enforces, checked here first so the
/// panel says why rather than the save failing on a constraint.
export const TITLE_LIMIT = 80;
export const SHORT_TITLE_LIMIT = 30;

export function checkHeading(h: Heading): Finding[] {
  const out: Finding[] = [];
  if (!h.moduleKey) out.push({ level: "error", message: "Pick the module this heading is for." });
  if (h.title !== null && !h.title.trim()) out.push({ level: "error", message: "The heading is empty." });
  if (h.title && h.title.length > TITLE_LIMIT) {
    out.push({ level: "error", message: `The heading is ${h.title.length} characters; it can be at most ${TITLE_LIMIT}.` });
  }
  if (h.title === null && h.shortTitle) {
    out.push({ level: "error", message: "A week-grid heading needs a heading to go with it." });
  }
  if (h.shortTitle && h.shortTitle.length > SHORT_TITLE_LIMIT) {
    out.push({
      level: "error",
      message: `The week-grid heading is ${h.shortTitle.length} characters; it can be at most ${SHORT_TITLE_LIMIT}.`,
    });
  }
  // About 12 characters fit on a line of a week-grid block before it wraps mid-word.
  if (h.title && !h.shortTitle && h.title.length > 24) {
    out.push({
      level: "info",
      message: "Long for the week grid, where the app will shorten it. Give a week-grid heading to choose the words yourself.",
    });
  }
  return out;
}

/// A heading is words for students to read, so it has to be the administrator's words — not
/// the model's paraphrase of them. Both headings must appear in what was said, ignoring case
/// and spacing.
export function checkHeadingProvenance(h: Heading, source: string): Finding[] {
  const said = squash(source);
  const unsaid = [h.title, h.shortTitle].filter((t): t is string => !!t && !said.includes(squash(t)));
  return unsaid.map((t) => ({
    level: "error" as const,
    message: `“${t}” isn't in what you wrote, so it's the assistant's wording. Say the exact heading you want.`,
  }));
}

function squash(text: string): string {
  return text.toLowerCase().replace(/[\s“”"'‘’]+/g, "");
}

export function describeHeading(h: Heading): string {
  return h.title === null ? `${h.moduleKey} back to DCU's name` : `${h.moduleKey} heading “${h.title}”`;
}
