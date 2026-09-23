/// One-off measurement: run the console's own extraction path against a document whose
/// correct answer is already known, and diff.
///
/// `EngineeringLabRotation.json` is the reference, checked cell by cell against both
/// rendered pages of this PDF on 23 Sep 2026. Before that it was "produced by hand from
/// this same PDF" and wrong in 35 of 67 sessions — the first honest run of this harness is
/// what found it. Imports the real schema and the real validators — measuring a copy would
/// say nothing about the console.
///
/// Lives inside `web/` because that is where its dependencies are: node resolves a bare
/// import by walking up from the importing file, and a repo-root `tools/` has no
/// node_modules above it.
///
/// Every provider goes through the same scoring at the bottom. Two models scored by two
/// pieces of code is a comparison of the two pieces of code.
///
///   cd web && npx tsx tools/rotation-harness.mts "<path to pdf>"
///   cd web && PROVIDER=mistral npx tsx tools/rotation-harness.mts "<path to pdf>"
///   MODEL=<id> overrides the model for either provider.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";
import { rotationSchema, validateRotation, type RotationSession } from "../src/lib/extraction/rotation.ts";
import { toJsonSchema } from "./json-schema.mts";

// Resolved from this file rather than from the working directory, so it behaves the same
// however it is invoked.
const web = join(dirname(fileURLToPath(import.meta.url)), "..");

const SYSTEM_INSTRUCTION = `
You transcribe timetable tables. You do not interpret them.

Rules, in order of importance:

1. If a cell is not clearly legible, emit null for that field. Never infer a value from
   surrounding rows, from what would be consistent, or from what a timetable usually looks
   like. A null is a correct answer; a plausible guess is not.
2. Emit one object per scheduled session actually printed in the document. Do not
   interpolate sessions that "should" be there, and do not merge two rows that look similar.
3. Do not correct apparent mistakes in the source. If the document says a room that seems
   wrong, transcribe what it says.
4. Use only the values permitted by the schema. If the document shows something outside
   them, emit null rather than the closest match.
`.trim();

const pdfPath = process.argv[2];
if (!pdfPath) throw new Error('usage: npx tsx tools/rotation-harness.mts "<path to pdf>"');
const truthPath = join(web, "..", "ios/DCUTimetable/Resources/EngineeringLabRotation.json");
const truth: RotationSession[] = JSON.parse(readFileSync(truthPath, "utf8")).sessions;

const env = readFileSync(join(web, ".env.local"), "utf8");
const secret = (name: string) => env.match(new RegExp(`^${name}=(.+)$`, "m"))?.[1].trim();

// The same words to every provider. A different instruction per model would make the
// comparison partly a comparison of prompts.
//
// This said "every lab session" until 23 Sep 2026. Only two of the four columns are
// headed "Lab", and Mistral Small took the word literally: it transcribed those two
// perfectly and skipped Workshop and Drawing. The instruction was measuring obedience to
// an ambiguity, not reading.
const INSTRUCTION =
  "Transcribe every session in this rotation table, from every column — one object per " +
  "filled cell. `activity` is the heading the cell sits under. Where a cell lists several " +
  "groups, put all of them in `groups`.";

type Run = { sessions: RotationSession[]; model: string; usage: string };

async function gemini(pdf: Buffer): Promise<Run> {
  const key = secret("GEMINI_API_KEY");
  if (!key) throw new Error("GEMINI_API_KEY not found in web/.env.local");
  const model = process.env.MODEL ?? "gemini-3.7-flash";
  const response = await new GoogleGenAI({ apiKey: key }).models.generateContent({
    model,
    contents: [{
      role: "user",
      parts: [
        { inlineData: { mimeType: "application/pdf", data: pdf.toString("base64") } },
        { text: INSTRUCTION },
      ],
    }],
    config: {
      temperature: 0,
      candidateCount: 1,
      maxOutputTokens: 8192,
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      responseSchema: rotationSchema,
    },
  });
  return {
    sessions: JSON.parse(response.text ?? "{}").sessions ?? [],
    model,
    usage: `${response.usageMetadata?.promptTokenCount} in / ${response.usageMetadata?.candidatesTokenCount} out`,
  };
}

/// Mistral reads a PDF in two steps where Gemini takes one: an OCR model turns the pages
/// into markdown, then a chat model structures that text. Both steps are reported, because
/// a cost comparison has to include the step Gemini does not need.
async function mistral(pdf: Buffer): Promise<Run> {
  const key = secret("MISTRAL_API_KEY");
  if (!key) {
    throw new Error(
      "MISTRAL_API_KEY not found in web/.env.local. Create a key at console.mistral.ai " +
      "(API keys), then add the line MISTRAL_API_KEY=... to web/.env.local yourself.",
    );
  }
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };

  const ocr = await post("https://api.mistral.ai/v1/ocr", headers, {
    model: "mistral-ocr-latest",
    document: { type: "document_url", document_url: `data:application/pdf;base64,${pdf.toString("base64")}` },
  });
  const markdown = (ocr.pages ?? []).map((p: { markdown: string }) => p.markdown).join("\n\n");

  const chat = await post("https://api.mistral.ai/v1/chat/completions", headers, {
    model: process.env.MODEL ?? "mistral-small-latest",
    temperature: 0,
    max_tokens: 8192,
    messages: [
      { role: "system", content: SYSTEM_INSTRUCTION },
      { role: "user", content: `${INSTRUCTION}\n\n${markdown}` },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "rotation", schema: toJsonSchema(rotationSchema), strict: true },
    },
  });

  return {
    sessions: JSON.parse(chat.choices?.[0]?.message?.content ?? "{}").sessions ?? [],
    // `-latest` is an alias. The response names what actually answered, which is the only
    // version worth recording next to a score.
    model: `${ocr.model} + ${chat.model}`,
    usage: `${ocr.usage_info?.pages_processed ?? "?"} OCR page(s) + ` +
      `${chat.usage?.prompt_tokens} in / ${chat.usage?.completion_tokens} out`,
  };
}

async function post(url: string, headers: Record<string, string>, body: unknown) {
  const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await r.text();
  // Reported verbatim. On a first run against a new API, the error body is the most useful
  // thing on the screen.
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}\n${text.slice(0, 600)}`);
  return JSON.parse(text);
}

const providers: Record<string, (pdf: Buffer) => Promise<Run>> = { gemini, mistral };
const provider = process.env.PROVIDER ?? "gemini";
const extract = providers[provider];
if (!extract) throw new Error(`PROVIDER must be "gemini" or "mistral", not "${provider}"`);

const started = Date.now();
const run = await extract(readFileSync(pdfPath));
const got = run.sessions;
const secs = ((Date.now() - started) / 1000).toFixed(1);

console.log(`\nmodel   ${run.model}   ${secs}s   ${run.usage}`);
console.log(`truth   ${truth.length} sessions`);
console.log(`got     ${got.length} sessions\n`);

console.log("--- validators (blind to ground truth) ---");
for (const f of validateRotation(got)) {
  console.log(`  [${f.level}] ${f.row ? `row ${f.row}: ` : ""}${f.message}`);
}

// Match on the whole row so a session that is right but duplicated, dropped or invented is
// visible. Sorted because row order is not part of the data.
const key1 = (s: RotationSession) =>
  [s.week, s.date, s.day, s.start, s.end, s.module, s.activity, (s.groups ?? []).slice().sort().join("")].join("|");

const truthKeys = truth.map(key1).sort();
const gotKeys = got.map(key1).sort();
const missing = truthKeys.filter((k) => !gotKeys.includes(k));
const extra = gotKeys.filter((k) => !truthKeys.includes(k));
const exact = truthKeys.length - missing.length;

console.log("\n--- diff against ground truth ---");
console.log(`  exact matches   ${exact}/${truth.length}  (${((exact / truth.length) * 100).toFixed(1)}%)`);
console.log(`  missing         ${missing.length}`);
console.log(`  invented        ${extra.length}`);
for (const m of missing.slice(0, 12)) console.log(`    - ${m}`);
for (const e of extra.slice(0, 12)) console.log(`    + ${e}`);

// Per-field accuracy over the rows that line up on week+module+groups, so one misaligned
// row does not read as every field being wrong.
const byAnchor = new Map(truth.map((s) => [`${s.week}|${s.module}|${(s.groups ?? []).slice().sort().join("")}`, s]));
const fields = ["week", "date", "day", "start", "end", "module", "activity", "groups"] as const;
const wrong: Record<string, number> = Object.fromEntries(fields.map((f) => [f, 0]));
let aligned = 0;
for (const g of got) {
  const t = byAnchor.get(`${g.week}|${g.module}|${(g.groups ?? []).slice().sort().join("")}`);
  if (!t) continue;
  aligned++;
  for (const f of fields) {
    const a = Array.isArray(g[f]) ? (g[f] as string[]).slice().sort().join("") : g[f];
    const b = Array.isArray(t[f]) ? (t[f] as string[]).slice().sort().join("") : t[f];
    if (a !== b) wrong[f]++;
  }
}
console.log(`\n--- per-field, over ${aligned} rows that anchor to a truth row ---`);
for (const f of fields) console.log(`  ${f.padEnd(8)} ${aligned - wrong[f]}/${aligned}`);
