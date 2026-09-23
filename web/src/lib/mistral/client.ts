import "server-only";

/// The key is read here and nowhere else, and this module is `server-only`, so importing it
/// from a client component is a build error rather than a leaked key. Deliberately not
/// `NEXT_PUBLIC_` — anything with that prefix is inlined into the browser bundle.
export function mistralKey(): string {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) throw new Error("MISTRAL_API_KEY is not set. Add it to web/.env.local (no NEXT_PUBLIC_ prefix).");
  return key;
}

/// Overridable without a code change, the same way the Gemini model was.
export const MISTRAL_MODEL = process.env.MISTRAL_MODEL || undefined;
