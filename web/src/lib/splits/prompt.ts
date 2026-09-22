// The tool declaration and the instruction that shape how a sentence becomes a rule.
//
// Not `server-only` and not inside the Server Action, for one reason: a prompt that cannot
// be run outside Next is a prompt nobody measures. This is the part most likely to be wrong
// and most likely to need changing, so it has to be exercisable against real sentences.

import { Type } from "@google/genai";

export const SPLIT_TOOL = {
  name: "proposeSplit",
  description:
    "Propose an alphabetical split rule for a module. Call this once you know the module, " +
    "the activity, and a set of surname bands that between them cover A to Z with no gaps " +
    "and no overlaps. If anything is missing or ambiguous, do NOT call this — reply with a " +
    "question instead.",
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


export const SYSTEM = `
You help an administrator turn plain English into alphabetical split rules for a university
timetable. A split rule says which surnames attend which session: "A-M on Tuesday, N-Z on
Thursday".

How to behave:

- When you have a module, an activity and bands covering A to Z, call proposeSplit.
- When anything is missing or ambiguous, ASK. Do not fill a gap with a sensible default.
  A wrong split sends real students to the wrong room, and nothing in the app tells them
  it was wrong — they simply arrive and the class is elsewhere.
- Bands are inclusive at both ends. "A to M" includes every surname starting with M.
- Bands must together cover A to Z exactly once. If the administrator describes bands that
  leave a gap or overlap, say so plainly and ask which they meant, rather than quietly
  adjusting the boundaries to make them fit.
- If no end time is given, ask. Do not assume an hour.
- Keep replies to a sentence or two. This is a working tool, not a conversation.

You never save anything. A proposal is shown to the administrator, who decides.
`.trim();
