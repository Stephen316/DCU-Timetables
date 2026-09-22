"use server";

import { currentProfile } from "@/lib/supabase/server";
import { gemini, EXTRACTION_MODEL, EXTRACTION_CONFIG, SYSTEM_INSTRUCTION } from "@/lib/gemini/client";
import { withRetry, classify } from "@/lib/gemini/retry";
import {
  rotationSchema,
  validateRotation,
  type RotationSession,
  type Finding,
} from "@/lib/extraction/rotation";

export type ExtractionResult = {
  ok: boolean;
  error?: string;
  /// True when trying the identical request again might work — a capacity blip rather than
  /// a bad document. The form uses it to offer a retry instead of sending you off to fix
  /// something that isn't broken.
  retryable?: boolean;
  sessions?: RotationSession[];
  findings?: Finding[];
  meta?: { model: string; ms: number; inputTokens?: number; outputTokens?: number };
};

/// Anything Gemini will accept inline. `.xlsx` and `.docx` are zips of XML — the model
/// cannot read the file itself, so they need converting to CSV or text first. That step is
/// deliberately not here yet: it should be dumb and deterministic, and pretending a
/// spreadsheet works today would hide that.
const ACCEPTED = ["application/pdf", "image/png", "image/jpeg", "image/webp", "text/csv", "text/plain"];

// Inline data has to travel in the request. Larger documents need the Files API.
const MAX_BYTES = 15 * 1024 * 1024;

export async function extractRotation(form: FormData): Promise<ExtractionResult> {
  // The layout already redirects non-admins, but a Server Action is its own entry point —
  // it is reachable by POST without ever rendering the page that hosts it.
  const profile = await currentProfile();
  if (!profile || profile.role !== "admin") return { ok: false, error: "Not allowed." };

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a file first." };
  if (file.size > MAX_BYTES) {
    return { ok: false, error: `${(file.size / 1e6).toFixed(1)} MB is over the 15 MB inline limit.` };
  }
  if (!ACCEPTED.includes(file.type)) {
    return { ok: false, error: `${file.type || "That file type"} can't be read directly. PDF, image, CSV or text.` };
  }

  const started = Date.now();
  try {
    const bytes = Buffer.from(await file.arrayBuffer()).toString("base64");

    const response = await withRetry(() => gemini().models.generateContent({
      model: EXTRACTION_MODEL,
      // Document first, instruction second: the model should read before being told what to
      // look for, and the ordering measurably affects table extraction.
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: file.type, data: bytes } },
            {
              text:
                "Transcribe every lab session in this rotation table. One object per session. " +
                "Where a session lists several groups, put all of them in `groups`.",
            },
          ],
        },
      ],
      config: {
        ...EXTRACTION_CONFIG,
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: rotationSchema,
      },
    }));

    const text = response.text;
    if (!text) return { ok: false, error: "The model returned nothing." };

    // The schema guarantees shape, not that a response arrived intact — a truncated stream
    // still fails to parse, and that must read as an error rather than as zero sessions.
    let parsed: { sessions?: RotationSession[] };
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, error: "The model's response was not valid JSON (likely truncated)." };
    }

    const sessions = parsed.sessions ?? [];
    return {
      ok: true,
      sessions,
      findings: validateRotation(sessions),
      meta: {
        model: EXTRACTION_MODEL,
        ms: Date.now() - started,
        inputTokens: response.usageMetadata?.promptTokenCount,
        outputTokens: response.usageMetadata?.candidatesTokenCount,
      },
    };
  } catch (e) {
    // withRetry has already exhausted anything worth retrying, so by here the failure is
    // either permanent or an outage. Either way the caller gets the plain-language version.
    const { retryable, message } = classify(e);
    return { ok: false, error: message, retryable };
  }
}
