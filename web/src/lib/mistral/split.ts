// A described split or timetable change → a proposal, or a question back. Tool calling rather than a forced
// schema, because "ask when something is missing" needs the model to be able to answer in
// prose instead of filling every field.

import { post, textOf, withRetry } from "./api";
import { CHANGE_TOOL, SPLIT_TOOL, SYSTEM } from "@/lib/proposals/prompt";
import { toJsonSchema } from "@/lib/extraction/json-schema";
import type { SplitRule } from "@/lib/proposals/rules";

export const SPLIT_MODEL = "mistral-small-latest";

export type ChatTurn = { role: "user" | "model"; text: string };

/// What the model proposed to change, as it said it — checked and normalised by the caller.
export type ChangeArgs = {
  kind?: string; module?: string; group?: string | null; dates?: string[]; start?: string;
  end?: string | null; title?: string | null; room?: string | null; activityCode?: string | null;
  note?: string | null;
};

/// `context` is what is known and saved for the selected module, sent as its own system
/// message so it is never mistaken for — or checked for provenance as — the admin's words.
export async function interpretMessage(opts: {
  key: string; history: ChatTurn[]; text: string; model?: string; context?: string;
}) {
  const { key, history, text, model = SPLIT_MODEL, context } = opts;
  const res = await withRetry(() => post<{
    model: string;
    choices: { message: { content: unknown; tool_calls?: { function: { name: string; arguments: unknown } }[] } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  }>("/chat/completions", key, {
    model,
    temperature: 0,
    max_tokens: 2048,
    messages: [
      { role: "system", content: SYSTEM },
      ...(context ? [{ role: "system", content: context }] : []),
      ...history.map((t) => ({ role: t.role === "model" ? "assistant" : "user", content: t.text })),
      { role: "user", content: text },
    ],
    tools: [SPLIT_TOOL, CHANGE_TOOL].map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: toJsonSchema(t.parameters) },
    })),
    tool_choice: "auto",
  }));

  const message = res.choices?.[0]?.message;
  // Arguments arrive as a JSON string in the OpenAI-compatible shape; accept an object too
  // rather than depending on which.
  const args = (name: string) => (message?.tool_calls ?? [])
    .filter((c) => c.function?.name === name)
    .map((c) => typeof c.function.arguments === "string" ? JSON.parse(c.function.arguments) : c.function.arguments);
  const split = (args(SPLIT_TOOL.name)[0] ?? null) as (Partial<SplitRule> & {
    ranges?: Partial<SplitRule["ranges"][number]>[];
  }) | null;
  const changes = args(CHANGE_TOOL.name) as ChangeArgs[];

  return {
    reply: textOf(message?.content).trim() || undefined,
    split,
    changes,
    model: res.model,
    usage: { input: res.usage?.prompt_tokens, output: res.usage?.completion_tokens },
  };
}
