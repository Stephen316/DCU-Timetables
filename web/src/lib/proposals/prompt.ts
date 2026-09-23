// The tool declarations and the instruction that shape how a sentence or a document becomes
// a proposal.
//
// Not `server-only` and not inside the Server Action, for one reason: a prompt that cannot
// be run outside Next is a prompt nobody measures. This is the part most likely to be wrong
// and most likely to need changing, so it has to be exercisable against real sentences.

import { Type } from "@google/genai";

export const SPLIT_TOOL = {
  name: "proposeSplit",
  description:
    "Propose an alphabetical split rule for a module — which surnames attend which session. " +
    "Call this once you know the module, the activity, and a set of surname bands that " +
    "between them cover A to Z with no gaps and no overlaps. If anything is missing or " +
    "ambiguous, do NOT call this — reply with a question instead.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      moduleKey: { type: Type.STRING, description: "Module code, e.g. EEG1001." },
      activity: {
        type: Type.STRING,
        description: "Which session this splits: Lecture, Tutorial, Lab, Workshop.",
      },
      ranges: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            from: { type: Type.STRING, description: "First surname letter, A-Z, inclusive." },
            to: { type: Type.STRING, description: "Last surname letter, A-Z, inclusive." },
            day: { type: Type.STRING, enum: ["Mon", "Tue", "Wed", "Thu", "Fri"] },
            start: { type: Type.STRING, description: "24-hour, e.g. 14:00." },
            end: { type: Type.STRING, description: "24-hour, e.g. 15:00." },
            room: { type: Type.STRING, nullable: true },
            label: { type: Type.STRING, nullable: true },
          },
          required: ["from", "to", "day", "start", "end", "room", "label"],
        },
      },
    },
    required: ["moduleKey", "activity", "ranges"],
  },
};

/// Splits only. Rotation documents used to share this prompt and a second tool, with the
/// model choosing between them; they now go through the extraction pipeline the harness
/// measures (`lib/mistral/rotation.ts`), so the words that read a table are the words that
/// were scored. What is left here is the conversation.
export const SYSTEM = `
You help an administrator maintain a university timetable. Your job is alphabetical splits:
a described rule — "surnames A-M have the lecture Tuesday, N-Z Thursday" — becomes a call
to proposeSplit. Rotation documents are handled separately: if someone asks about one, tell
them to attach it.

How to behave, in order of importance:

1. If something is missing or ambiguous, ASK. Never fill a gap with a sensible default. A
   wrong entry sends real students to the wrong room, and nothing in the app tells them it
   was wrong — they simply arrive and the class is elsewhere.
2. Surname bands are inclusive at both ends — "A to M" includes every surname starting with
   M — and must together cover A to Z exactly once. If the bands you are given leave a gap
   or overlap, say so plainly and ask which was meant, rather than quietly moving a
   boundary to make them fit.
3. If no end time is given, ask. Do not assume an hour.
4. Keep replies to a sentence or two. This is a working tool, not a conversation.

You never save anything. A proposal is shown to the administrator, who decides.
`.trim();
