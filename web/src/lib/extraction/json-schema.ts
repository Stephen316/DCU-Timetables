/// Converts a schema written in Gemini's dialect (`Type.OBJECT`, `nullable: true`) into
/// standard JSON Schema, for providers that speak the standard.
///
/// Converted rather than rewritten by hand, so every provider is held to the same
/// vocabularies. A hand-copied schema for a second provider would drift from the one the
/// console actually uses, and from then on the harness would be measuring the copy.
export function toJsonSchema(s: Record<string, any>): Record<string, any> {
  const kind = String(s.type).toLowerCase();
  const out: Record<string, any> = {};
  if (s.description) out.description = s.description;

  if (kind === "object") {
    out.type = "object";
    out.properties = Object.fromEntries(
      Object.entries(s.properties ?? {}).map(([k, v]) => [k, toJsonSchema(v as Record<string, any>)]),
    );
    out.required = s.required ?? Object.keys(s.properties ?? {});
    // Strict modes reject unlisted keys only if told to; without this a model can pad a
    // session with fields the scorer never reads, and nothing would say so.
    out.additionalProperties = false;
  } else if (kind === "array") {
    out.type = "array";
    out.items = toJsonSchema(s.items);
  } else {
    out.type = kind;
    if (s.enum) out.enum = [...s.enum];
  }

  // Gemini's `nullable: true` is the licence to decline an illegible cell. Dropping it in
  // translation would force the other model to guess, and a guess is exactly the failure
  // this schema exists to prevent.
  if (s.nullable) {
    out.type = [out.type, "null"];
    if (out.enum) out.enum = [...out.enum, null];
  }
  return out;
}
