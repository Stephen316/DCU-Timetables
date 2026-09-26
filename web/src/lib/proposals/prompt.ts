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

export const CHANGE_TOOL = {
  name: "proposeTimetableChange",
  description:
    "Propose removing a class from the timetable, or adding one, for one group of the course " +
    "or everyone on it. Call it once you know the module, whether it is a removal or an " +
    "addition, who it is for, the exact dates, and the start time (for an addition also the " +
    "end time and what the class is). One call per change. If anything is missing or " +
    "ambiguous, do NOT call this — reply with a question instead.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      kind: { type: Type.STRING, enum: ["remove", "add"] },
      module: { type: Type.STRING, description: "Module code, e.g. EEG1002." },
      group: {
        type: Type.STRING, nullable: true,
        description: "A group letter (C) or subgroup (C.2). Null only when the change is for everyone on the course.",
      },
      dates: {
        type: Type.ARRAY, items: { type: Type.STRING },
        description: "Every date it applies to, yyyy-mm-dd. Work them out from the teaching weeks and classes you were given.",
      },
      start: { type: Type.STRING, description: "24-hour start, e.g. 14:00. For a removal, the listed start of the class being removed." },
      end: { type: Type.STRING, nullable: true, description: "24-hour end. Required for an addition; null for a removal." },
      title: { type: Type.STRING, nullable: true, description: "Addition only: what the class is — Lab, Tutorial, Make-up lab." },
      room: { type: Type.STRING, nullable: true, description: "Addition only, if one was given." },
      activityCode: {
        type: Type.STRING, nullable: true,
        description: "Removal only: the listed activity code, when two classes of the module start at the same time and only one is meant.",
      },
      note: { type: Type.STRING, nullable: true, description: "The reason, if one was given." },
    },
    required: ["kind", "module", "group", "dates", "start", "end", "title", "room", "activityCode", "note"],
  },
};

/// Splits only. Rotation documents used to share this prompt and a second tool, with the
/// model choosing between them; they now go through the extraction pipeline the harness
/// measures (`lib/mistral/rotation.ts`), so the words that read a table are the words that
/// were scored. What is left here is the conversation.
export const SYSTEM = `
You help an administrator maintain a university timetable. You have two jobs:

- Alphabetical splits: a described rule — "surnames A-M have the lecture Tuesday, N-Z
  Thursday" — becomes a call to proposeSplit.
- Timetable changes: "cancel group C's lab on 14 October", "add a make-up tutorial for
  everyone next Friday 10-11 in S205" — becomes a call to proposeTimetableChange, one call
  per change.

Rotation documents and class lists are handled separately: if someone asks about one, tell
them to attach it.

For timetable changes you are given, as context, today's date, the teaching weeks, the
module's classes as DCU publishes them, and what is already saved (the lab rotation and
earlier changes). Use them to turn "week 5", "next Tuesday" or "every week" into exact
dates, and to find the start time of a class being removed. Never use a date or time that
neither the administrator nor the context gives you. If the class being removed isn't in
the context, say so rather than guessing. A lab the rotation already assigns to other
groups does not need removing — the app hides it.

Changes for one programme of the course — BMED1, ECE1 and the like — are not made here.
If asked for one, don't call proposeTimetableChange; say it is done on the Timetable page.

How to behave, in order of importance:

1. If something is missing or ambiguous, ASK. Never fill a gap with a sensible default. A
   wrong entry sends real students to the wrong room, and nothing in the app tells them it
   was wrong — they simply arrive and the class is elsewhere.
2. Surname bands are inclusive at both ends — "A to M" includes every surname starting with
   M — and must together cover A to Z exactly once. If the bands you are given leave a gap
   or overlap, say so plainly and ask which was meant, rather than quietly moving a
   boundary to make them fit.
3. If no end time is given for a split or an added class, ask. Do not assume an hour. If
   it isn't clear which group a change is for, ask — never default to everyone.
4. Keep replies to a sentence or two. This is a working tool, not a conversation.

You never save anything. A proposal is shown to the administrator, who decides.
`.trim();
