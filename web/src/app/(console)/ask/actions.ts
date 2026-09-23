"use server";

import { currentProfile, supabaseServer } from "@/lib/supabase/server";
import { mistralKey, MISTRAL_MODEL } from "@/lib/mistral/client";
import { classify } from "@/lib/mistral/api";
import { extractRotation } from "@/lib/mistral/rotation";
import { interpretSplit } from "@/lib/mistral/split";
import { checkRule, checkProvenance, type SplitRule } from "@/lib/proposals/rules";
import { checkScope, programmeFor, type Scope } from "@/lib/proposals/courses";
import type { Proposal } from "@/lib/proposals/types";
import { validateRotation } from "@/lib/extraction/rotation";

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
    const key = mistralKey();

    if (hasFile) {
      // A document is a rotation, and it goes through the pipeline the harness scores —
      // the same function, not a copy — rather than through the conversation below. The
      // transcription measured at 67/67 is the transcription that runs here.
      const document = {
        mimeType: file.type,
        base64: Buffer.from(await file.arrayBuffer()).toString("base64"),
      };
      const failed = (f: { level: string }[]) => f.some((x) => x.level === "error");

      let run = await extractRotation({ key, model: MISTRAL_MODEL, file: document });
      let checks = validateRotation(run.sessions);

      // Measured on 23 Sep 2026 against the engineering rotation: 8 of 9 readings were
      // perfect. The ninth, from byte-identical input, misplaced a column — and failed the
      // group-balance check, so it could not have been saved. The failure is the model's
      // occasional non-determinism, not the document's, so a second reading usually clears
      // it, and costs nothing when the first one passes. Only the rotation's own checks
      // trigger it: re-reading cannot fix a module that was never selected.
      let reread = false;
      if (failed(checks)) {
        const second = await extractRotation({ key, model: MISTRAL_MODEL, file: document });
        const secondChecks = validateRotation(second.sessions);
        if (!failed(secondChecks)) {
          run = second;
          checks = secondChecks;
          reread = true;
        }
      }

      const saved = run.sessions.filter((s) => s.groups?.length).length;
      return {
        ok: true,
        reply:
          (reread ? "The first reading failed the checks, so it was read again. " : "") +
          `Read ${run.pages ? `${run.pages} page${run.pages === 1 ? "" : "s"}` : "the file"}: ` +
          `${saved} sessions. Check them against the document before accepting.`,
        meta: { ms: Date.now() - started, inputTokens: run.usage.input, outputTokens: run.usage.output },
        proposal: {
          kind: "rotation", scope,
          courseKey: scope.programme,
          title: run.title,
          sessions: run.sessions,
          findings: [...checkScope(scope), ...checks],
        },
      };
    }

    // Stating the selection removes the clarifying round-trip — the first reply to a
    // well-formed split used to be "which module is this for?".
    const programme = programmeFor(scope.programme);
    const scopeLine = programme && scope.module
      ? `The administrator has selected ${programme.name} (${programme.key}), module ` +
        `${scope.module}. This request is for that module. Do not ask which module or ` +
        `course it is for. If the request plainly describes a different module, say so.`
      : "";

    const out = await interpretSplit({
      key,
      model: MISTRAL_MODEL,
      history,
      text: scopeLine ? `${scopeLine}\n\n${message}` : message,
    });
    const meta = { ms: Date.now() - started, inputTokens: out.usage.input, outputTokens: out.usage.output };

    if (out.split) {
      const a = out.split;
      const rule: SplitRule = {
        // The selection wins. What the model read is not discarded — it is compared against
        // this in checkScope, and a disagreement is an error that blocks saving.
        moduleKey: scope.module,
        activity: a.activity ?? "",
        // Normalised rather than trusted: the schema asks for single letters and the model
        // generally obliges, but "Mc" or "a" arriving instead would sort wrongly against
        // the A-Z comparisons in checkRule.
        ranges: (a.ranges ?? []).map((r) => ({
          from: (r.from ?? "").trim().toUpperCase().slice(0, 1),
          to: (r.to ?? "").trim().toUpperCase().slice(0, 1),
          day: r.day ?? "",
          start: r.start ?? "",
          end: r.end ?? "",
          room: r.room || null,
          label: r.label || null,
        })),
      };
      // What was actually said: the administrator's words and the model's own questions.
      // Not the scope line — this code wrote that, and it would vouch for anything.
      const source = [...history.map((t) => t.text), message].join("\n");
      return {
        ok: true, reply: out.reply, meta,
        proposal: {
          kind: "split", scope, rule, source,
          problems: [
            ...checkScope(scope, { module: a.moduleKey }),
            ...checkRule(rule),
            ...checkProvenance(rule, source),
          ],
        },
      };
    }

    return { ok: true, reply: out.reply || "No proposal — tell me what you want to change.", meta };
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
    const problems = [
      ...checkScope(proposal.scope),
      ...checkRule(proposal.rule),
      ...checkProvenance(proposal.rule, proposal.source ?? ""),
    ];
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

  // A session with no groups reaches no one — a blank cell the reader emitted, or one it
  // could not read. The review listed them in a single warning; they are not written.
  const sessions = proposal.sessions.filter((s) => s.groups?.length);
  const blocker = [...checkScope(proposal.scope), ...validateRotation(sessions)]
    .find((f) => f.level === "error");
  if (blocker) return { ok: false, error: blocker.message };
  if (!proposal.courseKey) return { ok: false, error: "No course — ask it which course this is for." };

  const { error } = await db.rpc("save_lab_rotation", {
    p_course_key: proposal.courseKey,
    p_title: proposal.title,
    p_sessions: sessions,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}
