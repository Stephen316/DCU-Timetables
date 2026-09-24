"use server";

import { currentProfile, supabaseServer } from "@/lib/supabase/server";
import { mistralKey, MISTRAL_MODEL } from "@/lib/mistral/client";
import { classify } from "@/lib/mistral/api";
import { readDocument, transcribeRotation, type ReadDocument } from "@/lib/mistral/rotation";
import { classifyDocument, classListToCsv } from "@/lib/mistral/roster";
import { correctTable } from "@/lib/mistral/correct";
import { applyToRoster, applyToRotation, rosterTable, rotationTable, ROSTER_COLUMNS, ROTATION_COLUMNS } from "@/lib/corrections/apply";
import type { RotationSession } from "@/lib/extraction/rotation";
import { normalise } from "@/lib/extraction/normalise";
import { interpretMessage, type ChangeArgs } from "@/lib/mistral/split";
import { classes, dublin, weeks } from "@/lib/dcu/timetable";
import { checkChangeProvenance, describeChange, fromRow, type TimetableChange } from "@/lib/changes/change";
import { reviewChange, saveChange } from "../timetable/actions";
import { checkRule, checkProvenance, type SplitRule } from "@/lib/proposals/rules";
import { checkScope, moduleFor, programmeFor, type Scope } from "@/lib/proposals/courses";
import type { Proposal } from "@/lib/proposals/types";
import type { Finding } from "@/lib/extraction/rotation";
import { validateRotation } from "@/lib/extraction/rotation";
import { nameKey, parseRoster, type RosterRow } from "@/lib/roster/parse";
import { validateRoster } from "@/lib/roster/validate";
import { MAX_UPLOAD_BYTES } from "@/lib/upload";

export type Turn = { role: "user" | "model"; text: string };

export type AskResult = {
  ok: boolean;
  error?: string;
  retryable?: boolean;
  reply?: string;
  proposal?: Proposal;
  /// Several at once — one message can ask for more than one timetable change.
  proposals?: Proposal[];
  meta?: { ms: number; inputTokens?: number; outputTokens?: number };
};


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

  if (hasFile && file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: `${(file.size / 1e6).toFixed(1)} MB is over the 4 MB limit.` };
  }

  const started = Date.now();
  try {
    // What was typed with the file is about the file — "the headings aren't students" —
    // and goes to every step that reads it. It used to be dropped here.
    if (hasFile) return await readUpload(file, scope, started, message);

    // A class list or rotation is waiting to be accepted: until it is, every message is
    // about it. The browser sends the version on the panel; accepting one starts a new
    // conversation, and messages go back to splits and timetable changes.
    const sent = form.get("document");
    const doc = typeof sent === "string" && sent ? documentFrom(sent) : null;
    if (doc) return await correctDocument(doc, message, history, started);

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

    const out = await interpretMessage({
      key,
      model: MISTRAL_MODEL,
      history,
      text: scopeLine ? `${scopeLine}\n\n${message}` : message,
      context: await changeContext(scope),
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

    if (out.changes.length) {
      const source = [...history.map((t) => t.text), message].join("\n");
      const proposals = await Promise.all(out.changes.map((a) => changeProposal(scope, a, source)));
      return { ok: true, reply: out.reply, meta, proposals };
    }

    return { ok: true, reply: out.reply || "No proposal — tell me what you want to change.", meta };
  } catch (e) {
    const { retryable, message: msg } = classify(e);
    return { ok: false, error: msg, retryable };
  }
}

/// What the model is shown about the selected module so it can turn "week 5" or "every
/// Tuesday" into dates and find the class being removed: today, the teaching weeks, DCU's
/// classes for the module, and what is saved. None of it is personal data — the class list
/// is deliberately not here.
async function changeContext(scope: Scope): Promise<string> {
  if (!programmeFor(scope.programme) || !scope.module) return "";
  const today = dublin(new Date().toISOString());
  const lines = [`Context for ${scope.programme}, module ${scope.module}. Today is ${today.day} ${today.date}.`];

  try {
    const all = await weeks();
    lines.push("", "Teaching weeks (week: its Monday): " + all.map((w) => `${w.label}: ${w.firstDay}`).join("; "));
    const found = await classes([scope.module], all.map((w) => w.number));
    const slots = new Map<string, string[]>();
    for (const c of found) {
      const k = `${c.code} (${c.kind}) ${c.day} ${c.start}–${c.end}${c.rooms.length ? `, ${c.rooms.join(" ")}` : ""}`;
      slots.set(k, [...(slots.get(k) ?? []), c.date]);
    }
    lines.push("", `${scope.module} classes as DCU publishes them (for everyone on the course):`);
    for (const [k, dates] of slots) lines.push(`- ${k}: ${dates.join(", ")}`);
    if (!slots.size) lines.push("- none");
  } catch {
    lines.push("", "DCU's timetable couldn't be reached, so its classes aren't listed. Ask for exact dates and times.");
  }

  const db = await supabaseServer();
  const [{ data: rot }, { data: saved }] = await Promise.all([
    db.from("lab_rotations").select("lab_rotation_sessions(date, day, start_time, end_time, module, activity, groups)")
      .eq("course_key", scope.programme).maybeSingle(),
    db.from("timetable_changes").select("*").eq("course_key", scope.programme).eq("module", scope.module),
  ]);
  const sessions = ((rot?.lab_rotation_sessions ?? []) as Record<string, any>[])
    .filter((s) => s.module === scope.module)
    .sort((a, b) => `${a.date}${a.start_time}`.localeCompare(`${b.date}${b.start_time}`));
  if (sessions.length) {
    lines.push("", `Saved lab rotation for ${scope.module} — which groups attend which session:`);
    for (const s of sessions) lines.push(`- ${s.date} ${s.day} ${s.start_time}–${s.end_time} ${s.activity ?? ""}: groups ${(s.groups ?? []).join(" ")}`);
  }
  if (saved?.length) {
    lines.push("", "Changes already saved:");
    for (const c of saved.map(fromRow)) lines.push(`- ${describeChange(c)}: ${c.dates.join(", ")}`);
  }
  return lines.join("\n");
}

async function changeProposal(scope: Scope, a: ChangeArgs, source: string): Promise<Proposal> {
  const kind = a.kind === "add" ? "add" : "remove";
  const change: TimetableChange = {
    courseKey: scope.programme,
    group: a.group?.trim().toUpperCase() || null,
    kind,
    // The selection wins, as for a split; what the model read is compared in checkScope.
    module: scope.module,
    activityCode: kind === "remove" ? a.activityCode?.trim() || null : null,
    title: kind === "add" ? a.title?.trim() || null : null,
    dates: [...new Set((a.dates ?? []).map((d) => d.trim()))].sort(),
    start: (a.start ?? "").trim().padStart(5, "0"),
    end: kind === "add" && a.end ? a.end.trim().padStart(5, "0") : null,
    room: kind === "add" ? a.room?.trim() || null : null,
    note: a.note?.trim() || null,
  };
  return {
    kind: "change", scope, change, source,
    findings: [
      ...checkScope(scope, { module: a.module }),
      ...(await reviewChange(change)),
      ...checkChangeProvenance(change, source),
    ],
  };
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
async function readUpload(file: File, scope: Scope, started: number, note: string): Promise<AskResult> {
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
    // A note goes through the same step as a follow-up: the model names operations and
    // code applies them, so the rows it doesn't mention are exactly as the document has them.
    let rows = direct.rows;
    let log = readFindings(direct.skipped, direct.notes);
    let noteReply = "";
    let noteModel = "";
    if (note) {
      const out = await correctTable({
        key, what: "class list", columns: ROSTER_COLUMNS.map(([c]) => c), rows: rosterTable(rows), message: note,
      });
      add(out.usage);
      const applied = applyToRoster(rows, out.ops);
      rows = applied.rows;
      log = [...log, ...applied.log];
      noteReply = out.reply;
      noteModel = out.model;
    }
    return rosterProposal(scope, file.name, rows,
      note ? `read directly; your note applied by ${noteModel}` : "read directly, no model",
      meta(),
      `Read ${rows.length} students from the ${source} (columns: ${direct.columns.join(", ")}).` +
        (direct.skipped.length ? ` ${direct.skipped.length} heading line${direct.skipped.length === 1 ? "" : "s"} left out.` : "") +
        (noteReply ? ` ${noteReply}` : ""),
      log);
  }

  const { kind, reason, usage: kindUsage } = await classifyDocument({ key, text: read.text, model: MISTRAL_MODEL, note });
  add(kindUsage);

  if (kind === "class_list") {
    const out = await classListToCsv({ key, text: read.text, model: MISTRAL_MODEL, note });
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
      `Check the names and groups against the document — a misread name is a student who never matches.` +
        (parsed.skipped.length ? ` ${parsed.skipped.length} heading line${parsed.skipped.length === 1 ? "" : "s"} left out.` : ""),
      readFindings(parsed.skipped, parsed.notes));
  }

  if (kind === "rotation") {
    const failed = (f: { level: string }[]) => f.some((x) => x.level === "error");
    let run = await transcribeRotation({ key, read, model: MISTRAL_MODEL, note });
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
      const second = await transcribeRotation({ key, read, model: MISTRAL_MODEL, note });
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
        log: [],
      },
    };
  }

  return {
    ok: true,
    reply: `This doesn't look like a class list or a lab rotation${reason ? ` (${reason})` : ""}, so nothing was proposed.`,
    meta: meta(),
  };
}

/// What reading left out or reinterpreted, shown on the proposal rather than only in the
/// reply, so it is in front of whoever accepts it.
function readFindings(skipped: { row: number; text: string }[], notes: string[]): Finding[] {
  return [
    ...(skipped.length ? [{
      level: "info" as const,
      message: `Not students, left out: ${skipped.map((x) => `row ${x.row} “${x.text}”`).join(", ")}.`,
    }] : []),
    ...notes.map((message) => ({ level: "info" as const, message })),
  ];
}

type DocProposal = Extract<Proposal, { kind: "roster" | "rotation" }>;

/// A follow-up about the class list or rotation on the panel. The reply answers it; any
/// operations become a new version of the proposal, with what changed logged on it. A
/// question changes nothing and makes no new version.
async function correctDocument(doc: DocProposal, message: string, history: Turn[], started: number): Promise<AskResult> {
  const key = mistralKey();
  const meta = (u: { input?: number; output?: number }) =>
    ({ ms: Date.now() - started, inputTokens: u.input, outputTokens: u.output });

  if (doc.kind === "roster") {
    const out = await correctTable({
      key, what: "class list", columns: ROSTER_COLUMNS.map(([c]) => c), rows: rosterTable(doc.rows), message, history,
    });
    if (!out.ops.length) return { ok: true, reply: out.reply || "Nothing to change.", meta: meta(out.usage) };
    const applied = applyToRoster(doc.rows, out.ops);
    const log = [...(doc.log ?? []), ...applied.log];
    return {
      ok: true, reply: out.reply, meta: meta(out.usage),
      proposal: {
        ...doc, rows: applied.rows, log,
        findings: [...rosterScope(doc.scope), ...log, ...validateRoster(applied.rows)],
      },
    };
  }

  const out = await correctTable({
    key, what: "lab rotation", columns: ROTATION_COLUMNS.map(([c]) => c), rows: rotationTable(doc.sessions), message, history,
  });
  if (!out.ops.length) return { ok: true, reply: out.reply || "Nothing to change.", meta: meta(out.usage) };
  const applied = applyToRotation(doc.sessions, out.ops);
  const log = [...(doc.log ?? []), ...applied.log];
  return {
    ok: true, reply: out.reply, meta: meta(out.usage),
    proposal: {
      ...doc, sessions: applied.sessions, log,
      findings: [...checkScope(doc.scope), ...log, ...validateRotation(applied.sessions)],
    },
  };
}

/// The proposal as the browser sent it back, rebuilt field by field rather than trusted as
/// it arrived. Its findings are recomputed after correcting, and saving checks everything
/// again, so nothing here is taken on the browser's word.
function documentFrom(raw: string): DocProposal | null {
  let p: Record<string, any>;
  try { p = JSON.parse(raw); } catch { return null; }
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  const scope: Scope = { programme: String(p?.scope?.programme ?? ""), module: String(p?.scope?.module ?? "") };
  const log: Finding[] = (Array.isArray(p?.log) ? p.log : [])
    .filter((f: any) => f && ["info", "warn", "error"].includes(f.level) && typeof f.message === "string")
    .map((f: any) => ({ level: f.level, message: f.message, ...(Number.isInteger(f.row) ? { row: f.row } : {}) }));

  if (p?.kind === "roster" && Array.isArray(p.rows)) {
    const rows: RosterRow[] = p.rows
      .map((r: any) => ({
        row: Number(r?.row), surname: str(r?.surname), given: str(r?.given), studentId: str(r?.studentId),
        group: str(r?.group), subgroup: str(r?.subgroup), day: str(r?.day), workshop: str(r?.workshop), drawing: str(r?.drawing),
      }))
      .filter((r: RosterRow) => Number.isInteger(r.row));
    return {
      kind: "roster", scope, courseKey: String(p.courseKey ?? ""), fileName: String(p.fileName ?? ""),
      readBy: String(p.readBy ?? ""), rows, log, findings: [],
    };
  }
  if (p?.kind === "rotation" && Array.isArray(p.sessions)) {
    const sessions: RotationSession[] = p.sessions.map((s: any) => ({
      week: Number.isInteger(s?.week) ? s.week : null, date: str(s?.date), day: str(s?.day),
      start: str(s?.start), end: str(s?.end), module: str(s?.module), activity: str(s?.activity),
      groups: Array.isArray(s?.groups) ? s.groups.filter((g: unknown) => typeof g === "string") : null,
    }));
    return { kind: "rotation", scope, courseKey: String(p.courseKey ?? ""), title: str(p.title), sessions, log, findings: [] };
  }
  return null;
}

function rosterProposal(
  scope: Scope, fileName: string, rows: RosterRow[], readBy: string,
  meta: AskResult["meta"], reply: string, extra: Finding[] = [],
): AskResult {
  return {
    ok: true,
    reply: `${reply} Accepting replaces ${scope.programme || "the selected programme"}'s class list.`,
    meta,
    proposal: {
      kind: "roster", scope, courseKey: scope.programme, fileName, readBy, rows, log: extra,
      findings: [...rosterScope(scope), ...extra, ...validateRoster(rows)],
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

  if (proposal.kind === "change") {
    const blocker = [...checkScope(proposal.scope), ...checkChangeProvenance(proposal.change, proposal.source ?? "")]
      .find((f) => f.level === "error");
    if (blocker) return { ok: false, error: blocker.message };
    // Re-checks the change, including against DCU's timetable, before it saves.
    return saveChange(proposal.change);
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
