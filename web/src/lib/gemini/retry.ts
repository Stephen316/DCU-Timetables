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
    case 429: {
      // Two different limits share this status, and they want opposite advice. A per-minute
      // limit clears on its own; a per-day limit does not clear until midnight Pacific, and
      // "wait a minute and try again" sends someone into a loop that cannot succeed.
      const q = quotaInfo(raw);
      if (q.perDay) {
        return {
          retryable: false,
          message:
            `Today's free Gemini quota is used up (${q.limit ?? "the daily"} requests for ` +
            `${q.model ?? "this model"}). It resets ${resetPhrase()} Irish time — ` +
            `sending again before then will not work.`,
        };
      }
      if (q.retryAfterSeconds !== undefined && q.retryAfterSeconds > 5) {
        return {
          retryable: false,
          message: `Gemini's per-minute limit is hit. Try again in about ${Math.ceil(q.retryAfterSeconds)} seconds.`,
        };
      }
      return { retryable: true, message: "Gemini's per-minute limit is hit. Try again in a moment." };
    }
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

/// The parts of a 429 that say which limit was hit. Gemini sends them as google.rpc detail
/// objects in the error body, and the SDK hands that body over as the error's message.
///
/// `quotaId` decides it, not `retryDelay`. The per-day 429 captured on 23 Sep 2026 carried
/// `retryDelay: "17s"` alongside `GenerateRequestsPerDayPerProjectPerModel-FreeTier` — a
/// delay that, taken at face value, promises a recovery that was sixteen hours away.
export function quotaInfo(raw: string): {
  perDay: boolean; model?: string; limit?: string; retryAfterSeconds?: number;
} {
  try {
    const body = JSON.parse(raw.slice(raw.indexOf("{")));
    const details: Record<string, unknown>[] = body?.error?.details ?? [];
    const violation = (details.find((d) => Array.isArray(d.violations))?.violations as
      { quotaId?: string; quotaValue?: string; quotaDimensions?: { model?: string } }[] | undefined)?.[0];
    const delay = details.find((d) => typeof d.retryDelay === "string")?.retryDelay as string | undefined;
    return {
      perDay: /PerDay/i.test(violation?.quotaId ?? ""),
      model: violation?.quotaDimensions?.model,
      limit: violation?.quotaValue,
      retryAfterSeconds: delay ? parseFloat(delay) : undefined,
    };
  } catch {
    return { perDay: false };
  }
}

/// Free-tier daily quotas reset at midnight Pacific. That is 07:00 UTC in daylight time and
/// 08:00 UTC otherwise, so rather than doing timezone arithmetic by hand, try both candidate
/// instants and keep the first one that Los Angeles actually calls midnight.
export function quotaResetsAt(now = new Date()): Date {
  const la = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Los_Angeles", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  for (let day = 0; day <= 1; day++) {
    for (const hourUtc of [7, 8]) {
      const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + day, hourUtc));
      if (t > now && la.format(t) === "00:00") return t;
    }
  }
  return new Date(now.getTime() + 24 * 3600 * 1000);
}

/// Rendered in Dublin time because the console has one admin and they are at DCU. The
/// server runs in iad1 on UTC, so the server's own clock would be the wrong answer.
function resetPhrase(now = new Date()): string {
  const at = quotaResetsAt(now);
  const dublin = (d: Date, o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-IE", { timeZone: "Europe/Dublin", ...o }).format(d);
  const time = dublin(at, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const sameDay = dublin(at, { dateStyle: "short" }) === dublin(now, { dateStyle: "short" });
  return sameDay ? `at ${time}` : `tomorrow at ${time}`;
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
