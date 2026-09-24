// Reads a class list — who is in which lab group — from a CSV, TSV or Markdown table.
//
// Every class list ends up here. One that already arrives as a headed table is parsed as
// it stands; anything else (a PDF, a photo, a list without usable headings) is first
// written out as CSV by the model (lib/mistral/roster.ts), and that CSV comes through here
// too. One reading of a class list, with one set of checks after it.
//
// Not `server-only`, so it can be exercised against a real file with tsx.

export type RosterRow = {
  /** 1-based line in the source table, so a finding can point at it. */
  row: number;
  surname: string | null;
  given: string | null;
  studentId: string | null;
  group: string | null;
  subgroup: string | null;
  day: string | null;
  workshop: string | null;
  drawing: string | null;
};

export type ParsedRoster =
  | {
      ok: true; rows: RosterRow[]; columns: string[];
      /** Lines inside the table that aren't students — a "Group B" heading between two
       *  groups, a header repeated on the next page. Reported, so nothing vanishes unseen. */
      skipped: { row: number; text: string }[];
      /** Anything the parser changed about how a column was read, in words. */
      notes: string[];
    }
  | { ok: false; error: string };

type Field = Exclude<keyof RosterRow, "row">;

/// The CSV a class list is normalised to: what the model is told to write, and what the
/// console offers for download.
export const ROSTER_HEADER = "Surname,First Name,Student ID,Group,Sub-group,Day,Workshop,Drawing";

export function csvField(v: string | null | undefined): string {
  const s = v ?? "";
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Header text -> field. Matched after lowercasing and collapsing punctuation to spaces, so
// "Sub-group", "Sub group" and "SUBGROUP" all land on the same thing.
const HEADERS: [RegExp, Field][] = [
  [/^(surname|family name|last name|lastname)$/, "surname"],
  [/^(first name|firstname|given name|given names|forename|forenames)$/, "given"],
  [/^(student id|student number|student no|id number)$/, "studentId"],
  [/^(group|lab group)$/, "group"],
  [/^(sub group|subgroup)$/, "subgroup"],
  [/^day$/, "day"],
  [/^workshop$/, "workshop"],
  [/^drawing$/, "drawing"],
];

function headerField(text: string): Field | null {
  const t = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return HEADERS.find(([re]) => re.test(t))?.[1] ?? null;
}

/// What a name reduces to on both sides of the match: the letters of given name then family
/// name, lowercased, accents dropped. "Seán O'Brien" -> "seanobrien", which is also what
/// sean.obrien3@mail.dcu.ie reduces to in resolve_allocation. Keep the two in step.
export function nameKey(given: string | null, surname: string | null): string | null {
  const letters = (s: string | null) =>
    (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
  const key = letters(given) + letters(surname);
  return key || null;
}

export function normaliseStudentId(raw: string | null): string | null {
  const s = (raw ?? "").replace(/\s+/g, "").toUpperCase();
  return s || null;
}

export function parseRoster(text: string): ParsedRoster {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  // A lone "Name" column counts towards finding the header, so the error below can say why
  // it isn't enough rather than claiming there is no header at all.
  const known = (cell: string) => headerField(cell) !== null || /^(full |student )?name$/i.test(cell.trim());
  const headerIndex = lines.findIndex((l) => splitLine(l, detect(l)).filter(known).length >= 2);
  if (headerIndex < 0) {
    return {
      ok: false,
      error:
        "No header row found. A class list needs headed columns — Surname and First name " +
        "(or Student ID), and Group.",
    };
  }

  const kind = detect(lines[headerIndex]);
  const headers = splitLine(lines[headerIndex], kind);
  const fields = headers.map(headerField);

  const has = (f: Field) => fields.includes(f);
  if (!has("group")) return { ok: false, error: "No Group column." };
  if (!(has("surname") && has("given")) && !has("studentId")) {
    return {
      ok: false,
      error:
        "Needs Surname and First name columns, a Student ID column, or both. A single " +
        "Name column can't be used: nothing says which part is the surname.",
    };
  }

  const rows: RosterRow[] = [];
  const skipped: { row: number; text: string }[] = [];
  let splitGroups = 0;
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    // Markdown's |---|---| divider, and the "# Sheet name" lines a spreadsheet becomes.
    if (kind === "markdown" && /^\s*\|?[\s:|-]+\|?\s*$/.test(line)) continue;
    if (line.trimStart().startsWith("#")) continue;
    // Prose around a Markdown table — a title, a footer — is not a row of it.
    if (kind === "markdown" && !line.trimStart().startsWith("|")) continue;
    const cells = splitLine(line, kind);
    if (cells.every((c) => c === "")) continue;
    // The same header again, as at the top of a workbook's second sheet.
    if (cells.map((c) => c.toLowerCase()).join("\u0000") === headers.map((h) => h.toLowerCase()).join("\u0000")) continue;
    // A header again with a cell changed ("Group B" where it said "Group"), or a heading
    // between groups: "Group B" alone on its line. Measured 24 Sep 2026 — the EEG1001 PDF
    // read as 210 students, three of them the headings of groups B, C and D.
    const filled = cells.map((c) => c.replace(/[*_]/g, "").trim()).filter(Boolean);
    if (filled.filter(known).length >= 2 || (filled.length > 0 && filled.length <= 2 && filled.every(isHeading))) {
      skipped.push({ row: i + 1, text: filled.join(" ") });
      continue;
    }

    const row: RosterRow = {
      row: i + 1, surname: null, given: null, studentId: null, group: null,
      subgroup: null, day: null, workshop: null, drawing: null,
    };
    fields.forEach((f, j) => {
      if (!f) return;
      const v = (cells[j] ?? "").trim();
      row[f] = v === "" ? null : v;
    });
    row.studentId = normaliseStudentId(row.studentId);
    // "A.4" under Group, with no Sub-group column: the group is A and A.4 is the subgroup.
    // Saved as it stood, the student's group would be "A.4" and the app — which looks the
    // rotation up by letter — would find no labs for them at all.
    const combined = row.group?.match(/^([A-Za-z])\.(\d{1,2})$/);
    if (combined && (!row.subgroup || row.subgroup.toUpperCase() === row.group!.toUpperCase())) {
      row.subgroup = row.group!.toUpperCase();
      row.group = combined[1].toUpperCase();
      splitGroups++;
    }
    rows.push(row);
  }

  return {
    ok: true,
    rows,
    columns: headers.filter((_, j) => fields[j]).map((h) => h.trim()),
    skipped,
    notes: splitGroups
      ? [`The Group column held subgroups like ${rows.find((r) => r.subgroup)?.subgroup}, so ${splitGroups} were read as group ${rows.find((r) => r.subgroup)?.group} and subgroup ${rows.find((r) => r.subgroup)?.subgroup}, and so on.`]
      : [],
  };
}

/// "Group B", "Lab group C.2", "GROUP A:" — a section heading, not a student.
function isHeading(cell: string): boolean {
  return /^((lab|sub)[\s-]?)?group\s*[A-Z](\.\d{1,2})?\s*:?$/i.test(cell) || /^((lab|sub)[\s-]?)?group\s*:?$/i.test(cell);
}

type Kind = "markdown" | "tsv" | "csv";

function detect(line: string): Kind {
  if (line.trim().startsWith("|")) return "markdown";
  if (line.includes("\t")) return "tsv";
  return "csv";
}

function splitLine(line: string, kind: Kind): string[] {
  if (kind === "markdown") {
    return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  }
  if (kind === "tsv") return line.split("\t").map((c) => c.trim());

  // CSV with quoted fields — a name like "O'Brien, Jr." must not become two columns.
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}
