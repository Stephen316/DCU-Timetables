// No `server-only` here on purpose: nothing below reads the key or touches the database.
// Keeping error handling out of the module that holds the secret is what makes it testable
// — and retry logic you cannot test is retry logic you are guessing about.

/// What a failure means for the caller, which is the only distinction that matters at the
/// point someone has clicked a button and is waiting.
export type GeminiFailure = { retryable: boolean; message: string };

/// Classify by HTTP status rather than by message text, which is prose and changes.
export function classify(error: unknown): GeminiFailure {
  const status = (error as { status?: number })?.status;
  const raw = error instanceof Error ? error.message : String(error);

  switch (status) {
    case 429:
      return {
        retryable: true,
        message: "Gemini's rate limit is hit. Wait a minute and try again.",
      };
    case 500:
    case 502:
    case 503:
    case 504:
      // Capacity, not correctness. On the free tier this is common during demand spikes —
      // paid traffic is served first and free quota gets what is left.
      return {
        retryable: true,
        message: "Gemini is busy right now. This usually clears in a few minutes.",
      };
    case 400:
      return {
        retryable: false,
        message: `Gemini rejected the request — the document or the schema needs attention. ${raw}`,
      };
    case 401:
    case 403:
      return {
        retryable: false,
        message: "GEMINI_API_KEY was rejected. Check the key in web/.env.local.",
      };
    default:
      // An unrecognised failure is reported as itself. Guessing at a friendlier wording
      // would hide the one case where the real message is the useful part.
      return { retryable: false, message: raw };
  }
}

/// Retries only what retrying can fix.
///
/// A 503 is the server having no capacity, so the same request a moment later may well
/// succeed. A 400 is the request being wrong, and sending it again three times only makes
/// the person wait longer for the same answer.
///
/// Delays are short on purpose: this runs inside a Server Action with someone watching a
/// spinner. Two retries at 1.5s and 4s add at most ~6s before giving up, which is worth it
/// for a transient blip and not worth it for an outage.
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  const delays = [1500, 4000];
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (error) {
      const { retryable } = classify(error);
      if (!retryable || i >= attempts - 1) throw error;
      await new Promise((r) => setTimeout(r, delays[Math.min(i, delays.length - 1)]));
    }
  }
}
