import type { SplitRule, RuleProblem } from "./rules";
import type { RotationSession, Finding } from "@/lib/extraction/rotation";

/// A proposal is whatever the model called a tool to suggest. Discriminated on `kind` so the
/// panel renders the right thing and `save` calls the right RPC — two proposals that share a
/// shape by accident would be one bug away from saving as each other.
export type Proposal =
  | { kind: "split"; rule: SplitRule; problems: RuleProblem[] }
  | { kind: "rotation"; courseKey: string; title: string | null;
      sessions: RotationSession[]; findings: Finding[] };
