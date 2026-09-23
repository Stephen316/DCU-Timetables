"use server";

import { currentProfile, supabaseServer } from "@/lib/supabase/server";
import { gemini, EXTRACTION_MODEL } from "@/lib/gemini/client";
import { withRetry, classify } from "@/lib/gemini/retry";
import { checkRule, type SplitRule } from "@/lib/proposals/rules";
import { checkScope, programmeFor, type Scope } from "@/lib/proposals/courses";
import { SPLIT_TOOL, ROTATION_TOOL, SYSTEM } from "@/lib/proposals/prompt";
import type { Proposal } from "@/lib/proposals/types";
import { validateRotation, type RotationSession } from "@/lib/extraction/rotation";

export type Turn = { role: "user" | "model"; text: string };

export type AskResult = {
  ok: boolean;
  error?: string;
  retryable?: boolean;
  reply?: string;
  proposal?: Proposal;
  meta?: { ms: number; inputTokens?: number; outputTokens?: number };
};

const ACCEPTED = ["application/pdf", "image/png", "image/jpeg", "image/webp", "text/csv", "text/plain"];
const MAX_BYTES = 15 * 1024 * 1024;

export async function ask(form: FormData): Promise<AskResult> {
  // The layout redirects non-admins, but a Server Action is its own entry point — reachable
  // by POST without ever rendering the page that hosts it.
  const profile = await currentProfile();
  if (!profile || profile.role !== "admin") return { ok: false, error: "Not allowed." };

  const scope: Scope = {
    programme: String(form.get("programme") ?? "").trim(),
    module: String(form.get("module") ?? "").trim(),
  };
  const message = String(form.get("message") ?? "").trim();
  const history: Turn[] = JSON.parse(String(form.get("history") ?? "[]"));
  const file = form.get("file");
  const hasFile = file instanceof File && file.size > 0;

  if (!message && !hasFile) return { ok: false, error: "Type something, or attach a document." };

  if (hasFile) {
    if (file.size > MAX_BYTES) {
      return { ok: false, error: `${(file.size / 1e6).toFixed(1)} MB is over the 15 MB limit.` };
    }
    if (!ACCEPTED.includes(file.type)) {
      // .xlsx and .docx are zips of XML — the model cannot read the file itself. Converting
      // them is a deterministic step that isn't written yet, and saying so beats failing
      // opaquely halfway through an extraction.
      return {
        ok: false,
        error: `${file.type || "That file type"} can't be read directly. PDF, image, CSV or text.`,
      };
    }
  }

  const started = Date.now();
  try {
    // A document goes before the text so the model reads before being told what to look
    // for; the ordering measurably affects table extraction.
    const parts: Record<string, unknown>[] = [];
    if (hasFile) {
      parts.push({
        inlineData: {
          mimeType: file.type,
          data: Buffer.from(await file.arrayBuffer()).toString("base64"),
        },
      });
    }
    // Stating the selection removes the clarifying round-trip — the model's first reply to
    // a well-formed split used to be "which module is this for?". On a free tier metered in
    // requests per day, a turn spent asking something already on screen is expensive.
    const programme = programmeFor(scope.programme);
    if (programme && scope.module) {
      parts.push({
        text:
          `The administrator has selected ${programme.name} (${programme.key}), module ` +
          `${scope.module}. This request is for that module. Do not ask which module or ` +
          `course it is for. If the request plainly describes a different module, say so.`,
      });
    }
    parts.push({ text: message || "Transcribe this document." });

    const response = await withRetry(() =>
      gemini().models.generateContent({
        model: EXTRACTION_MODEL,
        contents: [
          ...history.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
          { role: "user" as const, parts },
        ],
        config: {
          // Deterministic on purpose. The same sentence, or the same document, should give
          // the same proposal twice — otherwise re-reading one you rejected tells you
          // nothing, and a measured accuracy figure means nothing either.
          temperature: 0,
          maxOutputTokens: 8192,
          systemInstruction: SYSTEM,
          // Both tools every turn. The model picks by what it was handed, which is the
          // whole point of merging the screens: you should not have to know which kind of
          // thing you are about to do before you start doing it.
          tools: [{ functionDeclarations: [SPLIT_TOOL, ROTATION_TOOL] }],
        },
      }),
    );

    const reply = response.text?.trim();
    const meta = {
      ms: Date.now() - started,
      inputTokens: response.usageMetadata?.promptTokenCount,
      outputTokens: response.usageMetadata?.candidatesTokenCount,
    };

    const split = response.functionCalls?.find((c) => c.name === "proposeSplit");
    if (split) {
      const a = split.args as unknown as SplitRule;
      const rule: SplitRule = {
        // The selection wins. What the model read is not discarded — it is compared against
        // this in checkScope, and a disagreement is an error that blocks saving.
        moduleKey: scope.module,
        activity: a.activity ?? "",
        // Normalised rather than trusted: the schema asks for single letters and the model
        // generally obliges, but "Mc" or "a" arriving instead would sort wrongly against
        // the A-Z comparisons in checkRule.
        ranges: (a.ranges ?? []).map((r) => ({
          ...r,
          from: (r.from ?? "").trim().toUpperCase().slice(0, 1),
          to: (r.to ?? "").trim().toUpperCase().slice(0, 1),
          room: r.room || null,
          label: r.label || null,
        })),
      };
      return {
        ok: true, reply, meta,
        proposal: {
          kind: "split", scope, rule,
          problems: [...checkScope(scope, { module: a.moduleKey }), ...checkRule(rule)],
        },
      };
    }

    const rotation = response.functionCalls?.find((c) => c.name === "proposeRotation");
    if (rotation) {
      const a = rotation.args as unknown as {
        courseKey?: string; title?: string | null; sessions?: RotationSession[];
      };
      const sessions = a.sessions ?? [];
      return {
        ok: true, reply, meta,
        proposal: {
          kind: "rotation", scope,
          courseKey: scope.programme,
          title: a.title ?? null,
          sessions,
          findings: [
            ...checkScope(scope, { programme: a.courseKey }),
            ...validateRotation(sessions),
          ],
        },
      };
    }

    return { ok: true, reply: reply || "No proposal — tell me what you want to change.", meta };
  } catch (e) {
    const { retryable, message: msg } = classify(e);
    return { ok: false, error: msg, retryable };
  }
}

/// Saving re-checks what is being saved, rather than trusting that it is the thing that was
/// shown. Once a proposal has been on screen, the payload and the picture are two different
/// objects.
export async function accept(proposal: Proposal) {
  const profile = await currentProfile();
  if (!profile || profile.role !== "admin") return { ok: false, error: "Not allowed." };
  const db = await supabaseServer();

  if (proposal.kind === "split") {
    const problems = [...checkScope(proposal.scope), ...checkRule(proposal.rule)];
    const blocker = problems.find((p) => p.level === "error");
    if (blocker) return { ok: false, error: blocker.message };

    const { error } = await db.rpc("save_module_split", {
      p_module_key: proposal.rule.moduleKey,
      p_activity: proposal.rule.activity,
      p_note: null,
      p_ranges: proposal.rule.ranges,
    });
    return error ? { ok: false, error: error.message } : { ok: true };
  }

  const blocker = [...checkScope(proposal.scope), ...validateRotation(proposal.sessions)]
    .find((f) => f.level === "error");
  if (blocker) return { ok: false, error: blocker.message };
  if (!proposal.courseKey) return { ok: false, error: "No course — ask it which course this is for." };

  const { error } = await db.rpc("save_lab_rotation", {
    p_course_key: proposal.courseKey,
    p_title: proposal.title,
    p_sessions: proposal.sessions,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}
