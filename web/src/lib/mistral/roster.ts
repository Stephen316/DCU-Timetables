// Class lists through the model: "what is this document?" and "write it out as CSV".
// csv_pipeline.mmd n61 (extraction) and n62 (document type).
//
// The model writes CSV rather than JSON. It is a third of the tokens for a 200-row list,
// and the CSV goes through the same parser and validators as an uploaded CSV, so there is
// one reading of a class list, not two that can drift.

import { post, textOf, withRetry } from "./api";
import { toJsonSchema } from "@/lib/extraction/json-schema";
import { ROTATION_MODEL } from "./rotation";
import { ROSTER_HEADER } from "@/lib/roster/parse";

type Chat = {
  model: string;
  choices: { message: { content: unknown }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export type DocumentKind = "class_list" | "rotation" | "other";

const KIND_SCHEMA = {
  type: "OBJECT",
  properties: {
    kind: { type: "STRING", enum: ["class_list", "rotation", "other"] },
    reason: { type: "STRING" },
  },
  required: ["kind", "reason"],
};

/// Enough of the document to tell the two apart; a class list announces itself in its
/// first rows, and so does a rotation grid.
const SAMPLE = 6000;

export async function classifyDocument(opts: { key: string; text: string; model?: string }) {
  const { key, text, model = ROTATION_MODEL } = opts;
  const chat = await withRetry(() => post<Chat>("/chat/completions", key, {
    model,
    temperature: 0,
    max_tokens: 200,
    messages: [
      {
        role: "system",
        content:
          "You sort documents a university timetable administrator uploads. Answer with the " +
          "document's kind:\n" +
          "- class_list: a list of students — by name or by student number — with the lab " +
          "group each is in. May also give subgroup, day and rooms.\n" +
          "- rotation: a schedule of which groups attend which lab in which week, usually a " +
          "grid of weeks or dates against modules or activities. It lists groups, not students.\n" +
          "- other: anything else.",
      },
      { role: "user", content: text.slice(0, SAMPLE) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "kind", schema: toJsonSchema(KIND_SCHEMA), strict: true },
    },
  }));
  const out = JSON.parse(textOf(chat.choices?.[0]?.message?.content) || "{}");
  const kind: DocumentKind = ["class_list", "rotation", "other"].includes(out.kind) ? out.kind : "other";
  return {
    kind,
    reason: String(out.reason ?? ""),
    usage: { input: chat.usage?.prompt_tokens, output: chat.usage?.completion_tokens },
  };
}

const TO_CSV_SYSTEM = `
You transcribe a class list into CSV. Output ONLY the CSV — no commentary, no code fence.

The first line is exactly this header:
${ROSTER_HEADER}

Then one line per student, in the order they appear. Rules:

1. Transcribe; never invent. A value the document does not give is left empty. Never fill a
   gap from a neighbouring row.
2. Surname is the family name; First Name is the given name or names. If the document gives
   one name column, split it using the document's own convention: "Surname, Given" when
   there is a comma; otherwise use the column heading or the pattern of the rows. Keep
   accents, apostrophes and hyphens as written.
3. Student ID is the student number exactly as written, e.g. A12345678.
4. Group is the lab group as written, e.g. "A". Sub-group is the finer allocation if there
   is one, e.g. "A.1". If the document gives only a combined value like "A.1", put "A" in
   Group and "A.1" in Sub-group.
5. Day, Workshop and Drawing are the day and rooms given for that student, if any.
6. Quote any value containing a comma.
`.trim();

/// Long enough for ~600 students; a list that hits it is refused rather than half-saved.
const MAX_TOKENS = 16384;

export async function classListToCsv(opts: { key: string; text: string; model?: string }) {
  const { key, text, model = ROTATION_MODEL } = opts;
  const chat = await withRetry(() => post<Chat>("/chat/completions", key, {
    model,
    temperature: 0,
    max_tokens: MAX_TOKENS,
    messages: [
      { role: "system", content: TO_CSV_SYSTEM },
      { role: "user", content: text },
    ],
  }));
  const choice = chat.choices?.[0];
  if (choice?.finish_reason === "length") {
    throw new Error("The class list is too long to read in one go. Split it into parts and upload each.");
  }
  // Told not to, but a fence is the commonest way for this to go wrong, and harmless to strip.
  const csv = textOf(choice?.message?.content).trim().replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/, "");
  return {
    csv,
    model: chat.model,
    usage: { input: chat.usage?.prompt_tokens, output: chat.usage?.completion_tokens },
  };
}
