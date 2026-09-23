// A described split → a proposal, or a question back. Tool calling rather than a forced
// schema, because "ask when something is missing" needs the model to be able to answer in
// prose instead of filling every field.

import { post, textOf, withRetry } from "./api";
import { SPLIT_TOOL, SYSTEM } from "@/lib/proposals/prompt";
import { toJsonSchema } from "@/lib/extraction/json-schema";
import type { SplitRule } from "@/lib/proposals/rules";

export const SPLIT_MODEL = "mistral-small-latest";

export type ChatTurn = { role: "user" | "model"; text: string };

export async function interpretSplit(opts: {
  key: string; history: ChatTurn[]; text: string; model?: string;
}) {
  const { key, history, text, model = SPLIT_MODEL } = opts;
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
      ...history.map((t) => ({ role: t.role === "model" ? "assistant" : "user", content: t.text })),
      { role: "user", content: text },
    ],
    tools: [{
      type: "function",
      function: {
        name: SPLIT_TOOL.name,
        description: SPLIT_TOOL.description,
        parameters: toJsonSchema(SPLIT_TOOL.parameters),
      },
    }],
    tool_choice: "auto",
  }));

  const message = res.choices?.[0]?.message;
  const call = message?.tool_calls?.find((c) => c.function?.name === SPLIT_TOOL.name);
  // Arguments arrive as a JSON string in the OpenAI-compatible shape; accept an object too
  // rather than depending on which.
  const raw = call?.function.arguments;
  const split = raw === undefined ? null
    : (typeof raw === "string" ? JSON.parse(raw) : raw) as Partial<SplitRule> & {
        ranges?: Partial<SplitRule["ranges"][number]>[];
      };

  return {
    reply: textOf(message?.content).trim() || undefined,
    split,
    model: res.model,
    usage: { input: res.usage?.prompt_tokens, output: res.usage?.completion_tokens },
  };
}
