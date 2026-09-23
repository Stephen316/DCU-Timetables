// The front door (csv_pipeline.mmd n60, CSV_PIPELINE.md §4.0): every upload becomes either
// text or a document the OCR step can read.
//
//   .xlsx          -> CSV, one block per sheet
//   .docx          -> text, with its tables as Markdown tables
//   .csv .tsv .md .txt -> as they are
//   PDF, images    -> passed through to OCR
//
// Deterministic, and no model: this is the one step that should never need one. .xlsx and
// .docx are zips of XML, read here with Node's own zlib rather than a dependency.

import { inflateRawSync } from "node:zlib";
import { csvField } from "@/lib/roster/parse";

export type Normalised =
  | { kind: "text"; text: string; from: string }
  | { kind: "document"; mimeType: string; base64: string }
  | { kind: "unsupported"; error: string };

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const OCR_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
const TEXT_EXT = /\.(csv|tsv|txt|md)$/i;

export function normalise(name: string, type: string, bytes: Buffer): Normalised {
  const lower = name.toLowerCase();
  if (type === XLSX || lower.endsWith(".xlsx")) {
    return { kind: "text", text: xlsxToCsv(unzip(bytes)), from: "spreadsheet" };
  }
  if (type === DOCX || lower.endsWith(".docx")) {
    return { kind: "text", text: docxToText(unzip(bytes)), from: "Word document" };
  }
  if (OCR_TYPES.includes(type)) return { kind: "document", mimeType: type, base64: bytes.toString("base64") };
  if (type.startsWith("text/") || TEXT_EXT.test(lower)) {
    return { kind: "text", text: bytes.toString("utf8"), from: "text" };
  }
  if (lower.endsWith(".xls") || lower.endsWith(".doc")) {
    return { kind: "unsupported", error: "That's the old Office format. Save it as .xlsx or .docx, or export a PDF." };
  }
  return {
    kind: "unsupported",
    error: `${type || "That file type"} can't be read. PDF, image, .xlsx, .docx, CSV or text.`,
  };
}

// ---------------------------------------------------------------------------
// Zip
// ---------------------------------------------------------------------------

/// Every file in the archive, by path. Reads the central directory, which is authoritative
/// — local headers can leave sizes blank when the writer streamed.
function unzip(buf: Buffer): Map<string, Buffer> {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error("Not a readable .xlsx or .docx — the file isn't a zip archive.");

  const files = new Map<string, Buffer>();
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);

    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    if (method === 0) files.set(name, raw);
    else if (method === 8) files.set(name, inflateRawSync(raw));

    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

function xml(files: Map<string, Buffer>, path: string): string {
  return files.get(path)?.toString("utf8") ?? "";
}

function decode(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

// ---------------------------------------------------------------------------
// .xlsx -> CSV
// ---------------------------------------------------------------------------

function xlsxToCsv(files: Map<string, Buffer>): string {
  // Shared strings: most text cells hold an index into this list. A rich-text string is
  // several <t> runs that belong together.
  const shared = [...xml(files, "xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((m) => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decode(t[1])).join(""));

  const names = [...xml(files, "xl/workbook.xml").matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((m) => decode(m[1]));
  const sheets = [...files.keys()]
    .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]));

  const blocks = sheets.map((path, i) => {
    const rows: string[][] = [];
    for (const row of xml(files, path).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const body = c[2] ?? "";
        const ref = attrs.match(/\br="([A-Z]+)\d+"/)?.[1];
        const col = ref ? columnIndex(ref) : cells.length;
        const t = attrs.match(/\bt="([^"]+)"/)?.[1];
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let value = "";
        if (t === "s" && v !== undefined) value = shared[Number(v)] ?? "";
        else if (t === "inlineStr") value = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join("");
        else if (v !== undefined) value = decode(v);
        while (cells.length < col) cells.push("");
        cells[col] = value;
      }
      if (cells.some((x) => x.trim() !== "")) rows.push(cells);
    }
    const csv = rows.map((r) => r.map(csvField).join(",")).join("\n");
    return sheets.length > 1 ? `# ${names[i] ?? `Sheet ${i + 1}`}\n${csv}` : csv;
  });
  return blocks.join("\n\n");
}

function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// ---------------------------------------------------------------------------
// .docx -> text, tables as Markdown
// ---------------------------------------------------------------------------

function docxToText(files: Map<string, Buffer>): string {
  const body = xml(files, "word/document.xml");
  const out: string[] = [];
  let line = "";
  let table: string[][] | null = null;
  let row: string[] | null = null;
  let cell: string | null = null;

  const append = (s: string) => {
    if (cell !== null) cell += s;
    else line += s;
  };

  for (const m of body.matchAll(/<(\/?)w:(tbl|tr|tc|p|t|tab|br)\b[^>]*?(\/?)>([^<]*)/g)) {
    const [, closing, tag, selfClosing, trailing] = m;
    if (!closing) {
      if (tag === "tbl") table = [];
      else if (tag === "tr") row = [];
      else if (tag === "tc") cell = "";
      else if (tag === "tab") append("\t");
      else if (tag === "br") append(" ");
      if (tag === "t" && !selfClosing) append(decode(trailing));
    } else {
      if (tag === "p") {
        if (cell !== null) cell += " ";
        else { out.push(line.trimEnd()); line = ""; }
      } else if (tag === "tc" && row) { row.push((cell ?? "").replace(/\s+/g, " ").trim()); cell = null; }
      else if (tag === "tr" && table && row) { table.push(row); row = null; }
      else if (tag === "tbl" && table) {
        // Pipes inside a cell would split it into two columns downstream.
        const md = table.map((r) => `| ${r.map((c) => c.replace(/\|/g, "/")).join(" | ")} |`);
        if (md.length) md.splice(1, 0, `|${table[0].map(() => "---").join("|")}|`);
        out.push("", ...md, "");
        table = null;
      }
    }
  }
  if (line.trim()) out.push(line);
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
