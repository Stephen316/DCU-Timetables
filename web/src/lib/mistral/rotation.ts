// Rotation document → rows. The pipeline the harness scored 67/67 on 23 Sep 2026, and the
// one the console runs: the harness imports this function rather than a copy of it.

import { post, ocr, textOf, withRetry, type Attachment } from "./api";
import { rotationSchema, type RotationSession } from "@/lib/extraction/rotation";
import { toJsonSchema } from "@/lib/extraction/json-schema";
import { TRANSCRIBE_SYSTEM, TRANSCRIBE_INSTRUCTION } from "@/lib/extraction/transcribe";

export const ROTATION_MODEL = "mistral-small-latest";

export type RotationRun = {
  sessions: RotationSession[];
  /// Rows the model emitted for blank cells, removed before anyone sees them.
  blankCells: number;
  title: string | null;
  pages: number;
  model: string;
  usage: { input?: number; output?: number };
};

export async function extractRotation(opts: {
  key: string; file: Attachment; model?: string;
}): Promise<RotationRun> {
  const { key, file, model = ROTATION_MODEL } = opts;

  // Two steps where some models take one: OCR turns pixels into markdown tables, then a
  // chat model structures the text. Text files skip the first step — they are already text.
  let text: string;
  let pages = 0;
  let ocrModel: string | null = null;
  if (file.mimeType.startsWith("text/")) {
    text = Buffer.from(file.base64, "base64").toString("utf8");
  } else {
    const read = await withRetry(() => ocr(key, file));
    text = read.markdown;
    pages = read.pages;
    ocrModel = read.model;
  }

  const chat = await withRetry(() => post<{
    model: string;
    choices: { message: { content: unknown } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  }>("/chat/completions", key, {
    model,
    // Same document, same rows, every time — otherwise a re-read tells you nothing and a
    // measured accuracy figure means nothing either.
    temperature: 0,
    max_tokens: 8192,
    messages: [
      { role: "system", content: TRANSCRIBE_SYSTEM },
      { role: "user", content: `${TRANSCRIBE_INSTRUCTION}\n\n${text}` },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "rotation", schema: toJsonSchema(rotationSchema), strict: true },
    },
  }));

  const all: RotationSession[] =
    JSON.parse(textOf(chat.choices?.[0]?.message?.content) || "{}").sessions ?? [];

  // A blank cell is not a session. The model marks one with an empty `groups` list, and
  // those rows go. A `null` is different — it is the model saying it could not read the
  // cell — and it stays, flagged, for a person to look at. Dropping nulls would turn
  // "illegible" into "nothing there", which is the one mistake nobody downstream can see.
  const sessions = all.filter((s) => !(Array.isArray(s.groups) && s.groups.length === 0));

  return {
    sessions,
    blankCells: all.length - sessions.length,
    title: text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null,
    pages,
    model: [ocrModel, chat.model].filter(Boolean).join(" + "),
    usage: { input: chat.usage?.prompt_tokens, output: chat.usage?.completion_tokens },
  };
}
