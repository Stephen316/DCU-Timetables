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
    "Propose removing a class from the timetable, or adding one, for some of the course's " +
    "lab groups or programmes, or everyone on it. Call it once you know the module, whether " +
    "it is a removal or an addition, who it is for, the exact dates, and the start time (for " +
    "an addition also the end time and what the class is). One call per class and time: " +
    "several groups or programmes losing or getting the same class share one call. If " +
    "anything is missing or ambiguous, do NOT call this — reply with a question instead.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      kind: { type: Type.STRING, enum: ["remove", "add"] },
      module: { type: Type.STRING, description: "Module code, e.g. EEG1002." },
      groups: {
        type: Type.ARRAY, items: { type: Type.STRING },
        description:
          "Who it is for: lab groups (C), subgroups (C.2) or the course's programmes (CE1), as " +
          "many as were named. Empty when it is for everyone on the course, or when keepFor says who keeps it.",
      },
      keepFor: {
        type: Type.ARRAY, items: { type: Type.STRING },
        description:
          "Removal only: the programmes that keep the class, when the administrator says who " +
          "keeps it rather than who loses it — \"only CE1 and ECE1 have the 10:00\". It is removed " +
          "for every other programme of the course. Empty otherwise.",
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
        description:
          "Removal only, and almost always null: the listed activity code, only when two classes of the " +
          "module start at the same time and only one is meant. It must be a class that starts at `start`.",
      },
      note: { type: Type.STRING, nullable: true, description: "The reason, if one was given." },
    },
    required: ["kind", "module", "groups", "keepFor", "dates", "start", "end", "title", "room", "activityCode", "note"],
  },
};

export const HEADING_TOOL = {
  name: "proposeHeading",
  description:
    "Propose the heading a module's classes show under in the app, in place of DCU's name " +
    "for it — or put DCU's name back. Use the administrator's exact " +
    "words for the heading; never reword, shorten or correct them yourself. If the heading " +
    "isn't clear, do NOT call this — ask what it should say.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      module: { type: Type.STRING, description: "Module code, e.g. EEG1006." },
      title: {
        type: Type.STRING, nullable: true,
        description: "The heading, exactly as the administrator wrote it. Null to put DCU's own name back.",
      },
    },
    required: ["module", "title"],
  },
};

/// Splits only. Rotation documents used to share this prompt and a second tool, with the
/// model choosing between them; they now go through the extraction pipeline the harness
/// measures (`lib/mistral/rotation.ts`), so the words that read a table are the words that
/// were scored. What is left here is the conversation.
export const SYSTEM = `
You help an administrator maintain a university timetable. You have three jobs:

- Alphabetical splits: a described rule — "surnames A-M have the lecture Tuesday, N-Z
  Thursday" — becomes a call to proposeSplit.
- Timetable changes: "cancel group C's lab on 14 October", "add a make-up tutorial for
  everyone next Friday 10-11 in S205" — becomes a call to proposeTimetableChange, one call
  per change.
- Headings: "call EEG1006 'Materials' in the app", "show Fundamentals of Professional
  Development as 'Prof Dev'", "put the old name back" — becomes a call to proposeHeading.
  The heading is the administrator's exact words: never reword, shorten or fix the
  spelling of it. A shorter name for the week grid alone isn't a heading: those are set on
  the Timetable page, from any of the module's classes, so if that's what they want, say so
  and propose nothing.

Rotation documents and class lists are handled separately: if someone asks about one, tell
them to attach it.

For timetable changes you are given, as context, today's date, the teaching weeks, the
module's classes as DCU publishes them, and what is already saved (the lab rotation and
earlier changes). Use them to turn "week 5", "next Tuesday" or "every week" into exact
dates, and to find the start time of a class being removed. Never use a date or time that
neither the administrator nor the context gives you. If the class being removed isn't in
the context, say so rather than guessing. A lab the rotation already assigns to other
groups does not need removing — the app hides it.

A course's programmes, when it has them, are listed in the context: each is a group a
change can be for, alongside the lab groups, and a student is on exactly one. Use the
programme codes for them. groups lists who LOSES the class; keepFor lists who still HAS it.
So:
- "remove group C's 10:00 tutorial": groups ["C"], keepFor [] — a lab group.
- "remove the 11:00 for BMED1 and CAM1": groups ["BMED1", "CAM1"], keepFor [].
- "the 10:00 tutorial is only for CE1 and ECE1": groups [], keepFor ["CE1", "ECE1"]; it is
  removed for every other programme.
- "CE1 has the 10:00 and everyone else the 11:00": two calls, each saying who has that
  class. The 10:00 with keepFor ["CE1"]; the 11:00 with keepFor every other programme,
  listed: ["BMED1", "CAM1", "ECE1", "ME1", "SSE1"].
Dates are the ones said: "on 8 October" is that day alone. "From now on" and "every week"
start today: never a date before today unless asked for.

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
