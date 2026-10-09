import type { SplitRule, RuleProblem } from "./rules";
import type { RotationSession, Finding } from "@/lib/extraction/rotation";
import type { Scope } from "./courses";
import type { RosterRow } from "@/lib/roster/parse";
import type { TimetableChange } from "@/lib/changes/change";
import type { Heading } from "./heading";

/// A proposal is whatever the model called a tool to suggest. Discriminated on `kind` so the
/// panel renders the right thing and `save` calls the right RPC — two proposals that share a
/// shape by accident would be one bug away from saving as each other.
///
/// `scope` is the programme and module that were selected when the proposal was made. It
/// travels with the proposal rather than being read again at save time, because the
/// dropdowns can move while a proposal sits on the panel: re-reading them would save the
/// thing you are looking at under a key you changed your mind about.
///
/// `source` is the conversation the split was read from — the administrator's words and
/// the model's questions. It travels for the same reason: `accept` re-runs the provenance
/// check against exactly what was said, not against whatever is typed next.
export type Proposal =
  | { kind: "split"; scope: Scope; rule: SplitRule; problems: RuleProblem[]; source: string }
  | { kind: "rotation"; scope: Scope; courseKey: string; title: string | null;
      sessions: RotationSession[]; findings: Finding[];
      /** What reading and each correction since changed, in words — carried from version
       *  to version so the latest shows the whole history. */
      log?: Finding[] }
  | { kind: "roster"; scope: Scope; courseKey: string; fileName: string;
      /** How the rows were got: parsed as they stood, or formatted by a model. */
      readBy: string;
      rows: RosterRow[]; findings: Finding[]; log?: Finding[] }
  | { kind: "change"; scope: Scope;
      /** The class and its dates. Who it is for is `groups`, so this alone can't be saved. */
      change: Omit<TimetableChange, "group">;
      /** One change each, saved together or not at all. Null is everyone on the course. */
      groups: (string | null)[];
      /** A removal's programmes that keep the class, when it was asked for that way. */
      keptFor: string[];
      findings: Finding[]; source: string }
  | { kind: "heading"; scope: Scope; heading: Heading;
      /**
       * What the app shows now: DCU's name, any heading already saved, and the week grid's
       * name, set on the Timetable page, which a heading doesn't change.
       */
      current: { dcu: string | null; saved: string | null; abbreviation: string | null };
      findings: Finding[]; source: string };
