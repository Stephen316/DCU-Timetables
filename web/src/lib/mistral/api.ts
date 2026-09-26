// Mistral's REST API, called with fetch rather than an SDK: three endpoints, and a
// dependency for three endpoints is a dependency to keep patched.
//
// No `server-only`, and no key in this file: callers pass the key in. That is what lets the
// harness import exactly the code the console runs, and it keeps the secret itself in one
// server-only module (`client.ts`).

const BASE = "https://api.mistral.ai/v1";

export class MistralError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(`Mistral HTTP ${status}: ${body.slice(0, 300)}`);
  }
}

export async function post<T>(path: string, key: string, body: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
  } catch (e) {
    // No status at all: DNS, a dropped connection, a timeout. Worth one more try.
    throw new MistralError(0, e instanceof Error ? e.message : String(e));
  }
  const text = await r.text();
  if (!r.ok) {
    const after = Number(r.headers.get("retry-after"));
    throw new MistralError(r.status, text, Number.isFinite(after) && after > 0 ? after : undefined);
  }
  return JSON.parse(text) as T;
}

export type Attachment = { mimeType: string; base64: string };

/// PDFs and images to markdown. Tables come back as markdown tables, which is what makes
/// the second step a reading job rather than a vision job.
export async function ocr(key: string, file: Attachment) {
  const document = file.mimeType === "application/pdf"
    ? { type: "document_url", document_url: `data:application/pdf;base64,${file.base64}` }
    : { type: "image_url", image_url: `data:${file.mimeType};base64,${file.base64}` };
  const res = await post<{
    pages: { markdown: string }[]; model: string; usage_info?: { pages_processed?: number };
  }>("/ocr", key, { model: "mistral-ocr-latest", document });
  return {
    markdown: res.pages.map((p) => p.markdown).join("\n\n"),
    pages: res.usage_info?.pages_processed ?? res.pages.length,
    model: res.model,
  };
}

/// The conversation as chat messages. A turn where the model only put a proposal on the
/// panel has no words, and Mistral rejects an assistant message with neither content nor
/// tool calls, so it stands in for them. The stand-in names no values on purpose: the
/// history is also where a proposal's room or times are checked for, and the model's own
/// guess must not vouch for itself.
export function historyMessages(history: { role: "user" | "model"; text: string }[]) {
  return history.map((t) => t.role === "model"
    ? { role: "assistant", content: t.text.trim() || "(I put a proposal on the panel for you to review.)" }
    : { role: "user", content: t.text });
}

/// Message content is a string for most models and an array of chunks for some. Only the
/// text chunks are wanted either way.
export function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === "object" && (c as { type?: string }).type === "text"
        ? String((c as { text?: string }).text ?? "") : ""))
      .join("");
  }
  return "";
}

export type Failure = { retryable: boolean; message: string };

/// What a failure means for someone waiting on a button, by status rather than by message
/// text, which is prose and changes.
export function classify(error: unknown): Failure {
  if (!(error instanceof MistralError)) {
    return { retryable: false, message: error instanceof Error ? error.message : String(error) };
  }
  const detail = (() => {
    try { return String(JSON.parse(error.body)?.message ?? "").slice(0, 160); } catch { return ""; }
  })();
  switch (error.status) {
    case 0:
      return { retryable: true, message: "Could not reach Mistral. Check the connection and try again." };
    case 401:
    case 403:
      return {
        retryable: false,
        message: "MISTRAL_API_KEY was rejected. Check the key in web/.env.local, or in Vercel.",
      };
    case 429:
      // Mistral's free tier limits requests per second, not per day — the opposite of the
      // Gemini quota that made "wait a minute" wrong. Here a short wait genuinely works.
      return {
        retryable: true,
        message: `Mistral's rate limit is hit${detail ? ` (${detail})` : ""}. Try again in a moment.`,
      };
    case 500:
    case 502:
    case 503:
    case 504:
      return { retryable: true, message: "Mistral is busy right now. This usually clears quickly." };
    default:
      // 400 and 422 are the request being wrong. The detail is the useful part.
      return { retryable: false, message: `Mistral rejected the request: ${detail || error.body.slice(0, 200)}` };
  }
}

/// Retries only what retrying can fix, and honours Retry-After when the server sends one.
/// Short on purpose: this runs inside a Server Action with someone watching a spinner.
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  const delays = [1500, 4000];
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (error) {
      if (!classify(error).retryable || i >= attempts - 1) throw error;
      const hinted = error instanceof MistralError && error.retryAfterSeconds
        ? error.retryAfterSeconds * 1000 : 0;
      if (hinted > 10_000) throw error;   // not worth holding the spinner for
      await new Promise((r) => setTimeout(r, Math.max(hinted, delays[Math.min(i, delays.length - 1)])));
    }
  }
}
