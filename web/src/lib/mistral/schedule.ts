// A schedule of one-off events for teams or groups → raw rows. "Preliminary Design
// Presentation Schedule": one row per team, with a date and a time, maybe a room.
//
// The model only transcribes. It is told to copy each cell as written and to leave out what
// the document doesn't say; converting a date, reading "2.15pm" or deciding how long a slot
// lasts is done in code (lib/schedule/parse.ts), where it can be checked, and every value
// returned is checked against the document's own text. Which columns the document has, what
// they are headed and in what order is for the model to work out — that is the point of
// using one here rather than a parser.

import { post, textOf, withRetry } from "./api";
import { toJsonSchema } from "@/lib/extraction/json-schema";
import { withNote } from "./roster";
import { ROTATION_MODEL } from "./rotation";
import type { RawEvent } from "@/lib/schedule/parse";

const SCHEDULE_SCHEMA = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING", nullable: true, description: "The document's own heading, as written." },
    module: { type: "STRING", nullable: true, description: "A module code in the heading, like EEG1001, if there is one." },
    event: {
      type: "STRING", nullable: true,
      description: "What each row is, in a few words, taken from the heading: \"Preliminary Design Presentation\".",
    },
    rows: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          who: { type: "STRING", nullable: true, description: "The team or group ID, exactly as written: \"A1.a\"." },
          date: { type: "STRING", nullable: true, description: "The date, exactly as written: \"11/11/2026\"." },
          time: { type: "STRING", nullable: true, description: "The start time, exactly as written: \"2.15pm\"." },
          end_time: { type: "STRING", nullable: true, description: "The end time, only if the document gives one." },
          room: { type: "STRING", nullable: true, description: "The room, exactly as written, if the document gives one." },
        },
        required: ["who", "date", "time", "end_time", "room"],
      },
    },
  },
  required: ["title", "module", "event", "rows"],
};

const SYSTEM = `
You transcribe a schedule of one-off events — a presentation, an assessment, an exam slot — for teams or groups into rows. One row per team or group, in the order they appear.

Rules:
1. Copy every cell exactly as written. Never convert a date or a time, never correct, never reformat: "11/11/2026" stays "11/11/2026" and "2.15pm" stays "2.15pm".
2. Transcribe; never invent. A value the document does not give is null. Never fill a gap from a neighbouring row, and never work out an end time: end_time is null unless the document gives one.
3. who is the team or group identifier — the first column headed Team, Team ID, Group or similar — exactly as written.
4. A table may be split across pages or have a section for each day; include the rows of all of them. A repeated header row, a blank row, a highlighted separator and a title are not rows; leave them out.
5. If the administrator's note says how to read the document, do so.
`.trim();

export async function transcribeSchedule(opts: { key: string; text: string; model?: string; note?: string }) {
  const { key, text, model = ROTATION_MODEL, note } = opts;
  const chat = await withRetry(() => post<{
    model: string;
    choices: { message: { content: unknown } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  }>("/chat/completions", key, {
    model,
    temperature: 0,
    max_tokens: 16384,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: withNote(note, text) },
    ],
    response_format: { type: "json_schema", json_schema: { name: "schedule", schema: toJsonSchema(SCHEDULE_SCHEMA), strict: true } },
  }));

  const out = JSON.parse(textOf(chat.choices?.[0]?.message?.content) || "{}");
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const rows: RawEvent[] = (Array.isArray(out.rows) ? out.rows : []).map((r: Record<string, unknown>) => ({
    who: str(r?.who), date: str(r?.date), time: str(r?.time), end_time: str(r?.end_time), room: str(r?.room),
  }));
  return {
    rows,
    title: str(out.title),
    module: str(out.module),
    event: str(out.event),
    model: chat.model,
    usage: { input: chat.usage?.prompt_tokens, output: chat.usage?.completion_tokens },
  };
}
