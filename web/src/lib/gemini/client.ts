import "server-only";
import { GoogleGenAI } from "@google/genai";

/// The key is read here and nowhere else, and this module is `server-only` so importing it
/// from a client component is a build error rather than a leaked key. It is deliberately
/// not `NEXT_PUBLIC_` — anything with that prefix is inlined into the browser bundle.
export function gemini() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to web/.env.local (no NEXT_PUBLIC_ prefix).",
    );
  }
  return new GoogleGenAI({ apiKey });
}

/// Free tier is Flash-only. An exact version, never a `-latest` alias, for two reasons:
/// an extraction that silently changes model is an extraction whose measured accuracy no
/// longer means anything, and aliases point at whatever pool everyone else's default
/// traffic lands on — which is where free-tier 503s come from first.
export const EXTRACTION_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.7-flash";

/// The job is transcription, not interpretation. Everything here exists to stop the model
/// being helpful in ways that produce plausible, wrong, unverifiable cells.
export const EXTRACTION_CONFIG = {
  // Same document, same answer twice. Without this a re-run is not a check.
  temperature: 0,
  candidateCount: 1,
  // Sized to the largest table we expect. A degenerate repeat loop terminates instead of
  // running to the context limit.
  maxOutputTokens: 8192,
} as const;

export const SYSTEM_INSTRUCTION = `
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
