"use server";

import { currentProfile, supabaseServer } from "@/lib/supabase/server";
import { mistralKey, MISTRAL_MODEL } from "@/lib/mistral/client";
import { classify } from "@/lib/mistral/api";
import { readDocument, transcribeRotation, type ReadDocument } from "@/lib/mistral/rotation";
import { classifyDocument, classListToCsv } from "@/lib/mistral/roster";
import { normalise } from "@/lib/extraction/normalise";
import { interpretSplit } from "@/lib/mistral/split";
import { checkRule, checkProvenance, type SplitRule } from "@/lib/proposals/rules";
import { checkScope, moduleFor, programmeFor, type Scope } from "@/lib/proposals/courses";
import type { Proposal } from "@/lib/proposals/types";
import { validateRotation } from "@/lib/extraction/rotation";
import { nameKey, parseRoster, type RosterRow } from "@/lib/roster/parse";
import { validateRoster } from "@/lib/roster/validate";

export type Turn = { role: "user" | "model"; text: string };

export type AskResult = {
  ok: boolean;
  error?: string;
  retryable?: boolean;
  reply?: string;
  proposal?: Proposal;
  meta?: { ms: number; inputTokens?: number; outputTokens?: number };
};

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

  if (hasFile && file.size > MAX_BYTES) {
    return { ok: false, error: `${(file.size / 1e6).toFixed(1)} MB is over the 15 MB limit.` };
  }

  const started = Date.now();
  try {
    if (hasFile) return await readUpload(file, scope, started);

    const key = mistralKey();

    // Stating the selection removes the clarifying round-trip — the first reply to a
    // well-formed split used to be "which module is this for?".
    const programme = programmeFor(scope.programme);
    const title = moduleFor(scope.module)?.title;
    const scopeLine = programme && scope.module
      ? `The administrator has selected ${programme.name} (${programme.key}), module ` +
        `${scope.module}${title ? ` (${title})` : ""}. This request is for that module. Do ` +
        `not ask which module or course it is for. If the request plainly describes a ` +
        `different module, say so.`
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

/// Any upload, whatever it is, through csv_pipeline.mmd's ingestion path:
///
///   normalise (n60)  .xlsx/.docx to text; PDFs and images to OCR; text as it is
///   document type (n62)
///       a headed table that parses as a class list  -> class list, no model needed
///       otherwise the model decides                 -> class list, rotation, or neither
///   class list  -> the model writes it out as CSV (n61) -> the same parser and validators
///   rotation    -> the transcription the harness measured
///   -> a proposal on the panel: the review screen (n34). Accept saves it.
async function readUpload(file: File, scope: Scope, started: number): Promise<AskResult> {
  const input = normalise(file.name, file.type, Buffer.from(await file.arrayBuffer()));
  if (input.kind === "unsupported") return { ok: false, error: input.error };

  const key = mistralKey();
  const read: ReadDocument = input.kind === "text"
    ? { text: input.text, pages: 0, ocrModel: null }
    : await readDocument(key, { mimeType: input.mimeType, base64: input.base64 });
  const source = input.kind === "text" ? input.from : read.pages ? `${read.pages}-page document` : "image";
  const usage = { input: 0, output: 0 };
  const add = (u: { input?: number; output?: number }) => { usage.input += u.input ?? 0; usage.output += u.output ?? 0; };
  const meta = () => ({ ms: Date.now() - started, inputTokens: usage.input, outputTokens: usage.output });

  // Already a table with the columns a class list needs: nothing to interpret, so it is
  // parsed as it stands. Cheaper, exact, and the names never leave the console.
  const direct = parseRoster(read.text);
  if (direct.ok && direct.rows.length > 0) {
    return rosterProposal(scope, file.name, direct.rows, "read directly, no model", meta(),
      `Read ${direct.rows.length} students from the ${source} (columns: ${direct.columns.join(", ")}).`);
  }

  const { kind, reason, usage: kindUsage } = await classifyDocument({ key, text: read.text, model: MISTRAL_MODEL });
  add(kindUsage);

  if (kind === "class_list") {
    const out = await classListToCsv({ key, text: read.text, model: MISTRAL_MODEL });
    add(out.usage);
    const parsed = parseRoster(out.csv);
    if (!parsed.ok || parsed.rows.length === 0) {
      return {
        ok: false,
        error: `It looks like a class list, but it couldn't be turned into rows${parsed.ok ? "" : `: ${parsed.error}`}`,
        meta: meta(),
      };
    }
    return rosterProposal(scope, file.name, parsed.rows, `formatted by ${out.model}`, meta(),
      `Read the ${source} as a class list and formatted it as CSV: ${parsed.rows.length} students. ` +
      `Check the names and groups against the document — a misread name is a student who never matches.`);
  }

  if (kind === "rotation") {
    const failed = (f: { level: string }[]) => f.some((x) => x.level === "error");
    let run = await transcribeRotation({ key, read, model: MISTRAL_MODEL });
    let checks = validateRotation(run.sessions);
    add(run.usage);

    // Measured on 23 Sep 2026 against the engineering rotation: 8 of 9 readings were
    // perfect. The ninth, from byte-identical input, misplaced a column — and failed the
    // group-balance check, so it could not have been saved. The failure is the model's
    // occasional non-determinism, not the document's, so a second reading usually clears
    // it, and costs nothing when the first one passes. Only the rotation's own checks
    // trigger it: re-reading cannot fix a module that was never selected.
    let reread = false;
    if (failed(checks)) {
      const second = await transcribeRotation({ key, read, model: MISTRAL_MODEL });
      add(second.usage);
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
        `Read the ${source} as a lab rotation: ${saved} sessions. Check them against the ` +
        `document before accepting.`,
      meta: meta(),
      proposal: {
        kind: "rotation", scope,
        courseKey: scope.programme,
        title: run.title,
        sessions: run.sessions,
        findings: [...checkScope(scope), ...checks],
      },
    };
  }

  return {
    ok: true,
    reply: `This doesn't look like a class list or a lab rotation${reason ? ` (${reason})` : ""}, so nothing was proposed.`,
    meta: meta(),
  };
}

function rosterProposal(
  scope: Scope, fileName: string, rows: RosterRow[], readBy: string,
  meta: AskResult["meta"], reply: string,
): AskResult {
  return {
    ok: true,
    reply: `${reply} Accepting replaces ${scope.programme || "the selected programme"}'s class list.`,
    meta,
    proposal: {
      kind: "roster", scope, courseKey: scope.programme, fileName, readBy, rows,
      findings: [...rosterScope(scope), ...validateRoster(rows)],
    },
  };
}

/// A class list belongs to a programme, not a module — the module selection plays no part.
function rosterScope(scope: Scope) {
  return programmeFor(scope.programme)
    ? []
    : [{ level: "error" as const, message: "Pick the programme this class list is for." }];
}

/// Only what the database needs: the name reduced to its key, never the name as written.
function members(rows: RosterRow[]) {
  return rows.map((r) => ({
    name_key: nameKey(r.given, r.surname),
    student_id: r.studentId,
    group: r.group,
    subgroup: r.subgroup,
    day: r.day,
    workshop: r.workshop,
    drawing: r.drawing,
  }));
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

  if (proposal.kind === "roster") {
    const blocker = [...rosterScope(proposal.scope), ...validateRoster(proposal.rows)]
      .find((f) => f.level === "error");
    if (blocker) return { ok: false, error: blocker.message };

    const programme = programmeFor(proposal.courseKey);
    const { error } = await db.rpc("save_roster", {
      p_course_key: proposal.courseKey,
      p_title: programme?.name ?? null,
      p_members: members(proposal.rows),
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
