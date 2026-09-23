// The tool declarations and the instruction that shape how a sentence or a document becomes
// a proposal.
//
// Not `server-only` and not inside the Server Action, for one reason: a prompt that cannot
// be run outside Next is a prompt nobody measures. This is the part most likely to be wrong
// and most likely to need changing, so it has to be exercisable against real sentences.

import { Type } from "@google/genai";
import { ENGINEERING_ROTATION } from "@/lib/extraction/rotation";

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

/// The same vocabularies as the standalone extractor, for the same reason: an `enum` is not
/// a rule the model may break, it constrains generation. `EEG1003` cannot be produced.
///
/// Every field stays nullable because constraining output makes guessing mandatory — given
/// a smudged cell and three legal values, a model with no other option picks one. The null
/// is what lets it decline, and the instruction below is what tells it that declining is
/// allowed.
export const ROTATION_TOOL = {
  name: "proposeRotation",
  description:
    "Propose a lab rotation extracted from a document — which groups attend which module in " +
    "which week. Call this after reading an attached rotation table. One entry per session " +
    "actually printed in the document.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      courseKey: { type: Type.STRING, description: "Course this rotation belongs to, e.g. EEG1." },
      title: { type: Type.STRING, nullable: true },
      sessions: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            week: { type: Type.INTEGER, nullable: true },
            date: { type: Type.STRING, nullable: true, description: "YYYY-MM-DD." },
            day: { type: Type.STRING, enum: [...ENGINEERING_ROTATION.days], nullable: true },
            start: { type: Type.STRING, enum: [...ENGINEERING_ROTATION.starts], nullable: true },
            end: { type: Type.STRING, enum: [...ENGINEERING_ROTATION.ends], nullable: true },
            module: { type: Type.STRING, enum: [...ENGINEERING_ROTATION.modules], nullable: true },
            activity: {
              type: Type.STRING,
              enum: [...ENGINEERING_ROTATION.activities],
              nullable: true,
              description: "The column heading the session sits under.",
            },
            groups: {
              type: Type.ARRAY,
              nullable: true,
              items: { type: Type.STRING, enum: [...ENGINEERING_ROTATION.groups] },
            },
            room: { type: Type.STRING, nullable: true },
          },
          required: ["week", "date", "day", "start", "end", "module", "activity", "groups", "room"],
        },
      },
    },
    required: ["courseKey", "title", "sessions"],
  },
};

export const SYSTEM = `
You help an administrator maintain a university timetable. You do two jobs, and you choose
between them by what you have been given.

**A described rule** — "surnames A-M have the lecture Tuesday, N-Z Thursday" — becomes a
call to proposeSplit.

**An attached document** — a rotation table as a PDF or a photo — becomes a call to
proposeRotation. Transcribe it; do not interpret it.

How to behave, in order of importance:

1. If something is missing or ambiguous, ASK. Never fill a gap with a sensible default. A
   wrong entry sends real students to the wrong room, and nothing in the app tells them it
   was wrong — they simply arrive and the class is elsewhere.
2. Reading a document, if a cell is not clearly legible, emit null for that field. Never
   infer a value from surrounding rows, from what would be consistent, or from what a
   timetable usually looks like. A null is a correct answer; a plausible guess is not.
3. Do not correct apparent mistakes in a source document. If it says a room that seems
   wrong, transcribe what it says.
4. Surname bands are inclusive at both ends — "A to M" includes every surname starting with
   M — and must together cover A to Z exactly once. If the bands you are given leave a gap
   or overlap, say so plainly and ask which was meant, rather than quietly moving a
   boundary to make them fit.
5. If no end time is given for a split, ask. Do not assume an hour.
6. Keep replies to a sentence or two. This is a working tool, not a conversation.

You never save anything. A proposal is shown to the administrator, who decides.
`.trim();
