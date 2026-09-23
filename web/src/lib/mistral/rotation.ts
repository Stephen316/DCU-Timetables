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

/// A document as text: what the OCR step produced, or the file itself when it already was.
export type ReadDocument = { text: string; pages: number; ocrModel: string | null };

/// Step one of two. OCR turns pixels into markdown tables; text files skip it — they are
/// already text. Split out so the console reads a document once and then decides what it
/// is, rather than paying for OCR again inside whichever extractor it picks.
export async function readDocument(key: string, file: Attachment): Promise<ReadDocument> {
  if (file.mimeType.startsWith("text/")) {
    return { text: Buffer.from(file.base64, "base64").toString("utf8"), pages: 0, ocrModel: null };
  }
  const read = await withRetry(() => ocr(key, file));
  return { text: read.markdown, pages: read.pages, ocrModel: read.model };
}

export async function extractRotation(opts: {
  key: string; file: Attachment; model?: string;
}): Promise<RotationRun> {
  return transcribeRotation({ key: opts.key, read: await readDocument(opts.key, opts.file), model: opts.model });
}

/// Step two: a chat model structures the text into sessions.
export async function transcribeRotation(opts: {
  key: string; read: ReadDocument; model?: string;
}): Promise<RotationRun> {
  const { key, model = ROTATION_MODEL } = opts;
  const { text, pages, ocrModel } = opts.read;

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
