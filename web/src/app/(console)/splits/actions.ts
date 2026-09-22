"use server";

import { currentProfile, supabaseServer } from "@/lib/supabase/server";
import { gemini, EXTRACTION_MODEL } from "@/lib/gemini/client";
import { withRetry, classify } from "@/lib/gemini/retry";
import { checkRule, type SplitRule, type RuleProblem } from "@/lib/splits/rules";
import { SPLIT_TOOL, SYSTEM } from "@/lib/splits/prompt";

export type Turn = { role: "user" | "model"; text: string };

export type ChatResult = {
  ok: boolean;
  error?: string;
  retryable?: boolean;
  /// What the model said. Present even when it also proposed a rule — it usually explains
  /// what it did, or flags the bit it was unsure about.
  reply?: string;
  /// Set only when the model called `proposeSplit`. Nothing is saved; this is a draft for
  /// you to look at.
  proposal?: SplitRule;
  problems?: RuleProblem[];
};

export async function sendSplitMessage(history: Turn[], message: string): Promise<ChatResult> {
  const profile = await currentProfile();
  if (!profile || profile.role !== "admin") return { ok: false, error: "Not allowed." };
  if (!message.trim()) return { ok: false, error: "Type something first." };

  try {
    const response = await withRetry(() =>
      gemini().models.generateContent({
        model: EXTRACTION_MODEL,
        contents: [
          ...history.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
          { role: "user" as const, parts: [{ text: message }] },
        ],
        config: {
          // Deterministic on purpose. The same sentence should give the same rule twice —
          // otherwise re-reading a proposal you rejected tells you nothing.
          temperature: 0,
          systemInstruction: SYSTEM,
          tools: [{ functionDeclarations: [SPLIT_TOOL] }],
        },
      }),
    );

    const call = response.functionCalls?.find((c) => c.name === "proposeSplit");
    const reply = response.text?.trim();

    if (!call) return { ok: true, reply: reply || "No proposal — ask me for a split." };

    const args = call.args as unknown as SplitRule;
    const proposal: SplitRule = {
      moduleKey: args.moduleKey ?? "",
      activity: args.activity ?? "",
      // Normalised here rather than trusted: the tool schema asks for single letters and
      // the model generally obliges, but "Mc" or "a" arriving instead would sort wrongly
      // against the A-Z comparisons in checkRule.
      ranges: (args.ranges ?? []).map((r) => ({
        ...r,
        from: (r.from ?? "").trim().toUpperCase().slice(0, 1),
        to: (r.to ?? "").trim().toUpperCase().slice(0, 1),
        room: r.room || null,
        label: r.label || null,
      })),
    };

    // Checked here, not left to the save step. A proposal with a gap at N should be visible
    // as a proposal with a gap at N, while you still have the sentence that produced it in
    // front of you.
    return { ok: true, reply, proposal, problems: checkRule(proposal) };
  } catch (e) {
    const { retryable, message: msg } = classify(e);
    return { ok: false, error: msg, retryable };
  }
}

export async function saveSplit(rule: SplitRule, note: string | null) {
  const profile = await currentProfile();
  if (!profile || profile.role !== "admin") return { ok: false, error: "Not allowed." };

  // The model's proposal is re-checked at the moment of saving. What is on screen and what
  // is in this payload are two different things once you have edited one of them.
  const problems = checkRule(rule);
  if (problems.some((p) => p.level === "error")) {
    return { ok: false, error: problems.find((p) => p.level === "error")!.message };
  }

  const { error } = await (await supabaseServer()).rpc("save_module_split", {
    p_module_key: rule.moduleKey,
    p_activity: rule.activity,
    p_note: note,
    p_ranges: rule.ranges.map((r) => ({
      from: r.from, to: r.to, day: r.day,
      start: r.start, end: r.end, room: r.room, label: r.label,
    })),
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}
