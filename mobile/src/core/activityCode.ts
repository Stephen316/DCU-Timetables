/**
 * Parses a DCU activity code such as `BIO1000[1]OC/L1/01 Surname A - M` into its parts.
 *
 * ```
 * BIO1000        module code
 * [1]            occurrence / semester
 * OC             delivery (OC on-campus, AY async, SY sync, …)
 * L1             activity kind (L/T/P/S/W) + index
 * 01             group number
 * Surname A - M  cohort label (splits a large class into groups)
 * ```
 *
 * The group number and cohort are what identify a *student's* stream, which drives
 * group-filtering and clash detection. Parsing is defensive: unknown shapes keep `raw`
 * and fall back to `other`.
 */
export type ActivityKind = 'L' | 'T' | 'P' | 'S' | 'W' | '?';

export interface ActivityCode {
  raw: string;
  moduleCode: string | null;
  occurrence: string | null;
  delivery: string | null;
  kind: ActivityKind;
  activityIndex: number | null;
  group: string | null;
  cohort: string | null;
}

const KIND_LABELS: Record<ActivityKind, string> = {
  L: 'Lecture',
  T: 'Tutorial',
  P: 'Lab',
  S: 'Seminar',
  W: 'Workshop',
  '?': 'Class',
};

export function kindLabel(kind: ActivityKind): string {
  return KIND_LABELS[kind];
}

/** A letter in any cased script. */
export function isLetter(ch: string): boolean {
  return ch.toLowerCase() !== ch.toUpperCase();
}

/** Whole-string integer, as Swift's `Int(_:)` reads one. */
export function parseInteger(text: string): number | null {
  return /^[+-]?\d+$/.test(text) ? Number(text) : null;
}

export function trimSpaces(text: string): string {
  return text.replace(/^[ \t]+|[ \t]+$/g, '');
}

export function parseActivityCode(name: string): ActivityCode {
  const trimmed = trimSpaces(name);

  // Split "code cohort" on the first space.
  let codePart: string;
  let cohort: string | null = null;
  const space = trimmed.indexOf(' ');
  if (space >= 0) {
    codePart = trimmed.slice(0, space);
    const rest = trimSpaces(trimmed.slice(space + 1));
    // A cross-listed module reads like "CHM1006[1]OC/L1/01, EEG1017[1]OC/L1/01" — the text
    // after the space is a second activity code, not a cohort. Real cohorts read like
    // "Surname A - M" and contain no "[" or "/".
    if (!rest.includes('[') && !rest.includes('/')) {
      cohort = rest.length === 0 ? null : rest;
    }
  } else {
    codePart = trimmed;
  }
  // Drop a trailing comma left by a cross-listed code (".../01," → ".../01").
  codePart = codePart.replace(/^,+|,+$/g, '');

  const segs = codePart.split('/').filter((s) => s.length > 0);

  // Segment 0: module[occurrence]delivery
  let module: string | null = null;
  let occurrence: string | null = null;
  let delivery: string | null = null;
  if (segs.length > 0) {
    const s0 = segs[0];
    const lb = s0.indexOf('[');
    const rb = s0.indexOf(']');
    if (lb >= 0 && rb > lb) {
      module = s0.slice(0, lb);
      occurrence = s0.slice(lb + 1, rb);
      const after = s0.slice(rb + 1);
      delivery = after.length === 0 ? null : after;
    } else {
      module = s0;
    }
  }

  // Segment 1: activity kind + index (e.g. "L1")
  let kind: ActivityKind = '?';
  let activityIndex: number | null = null;
  if (segs.length > 1) {
    const s1 = segs[1];
    let letters = 0;
    while (letters < s1.length && isLetter(s1[letters])) letters++;
    if (letters > 0) {
      const first = s1[0].toUpperCase();
      kind = first in KIND_LABELS && first !== '?' ? (first as ActivityKind) : '?';
    }
    activityIndex = parseInteger(s1.slice(letters));
  }

  return {
    raw: name,
    moduleCode: module && module.length > 0 ? module : null,
    occurrence: occurrence && occurrence.length > 0 ? occurrence : null,
    delivery,
    kind,
    activityIndex,
    // Segment 2: group number
    group: segs.length > 2 ? segs[2] : null,
    cohort,
  };
}

/** A short human label, e.g. "Lecture · Group 01". */
export function activitySummary(activity: ActivityCode): string {
  const parts = [kindLabel(activity.kind)];
  if (activity.group !== null) parts.push(`Group ${activity.group}`);
  return parts.join(' · ');
}
