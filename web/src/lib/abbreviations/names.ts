// DCU puts the module's code in front of its name: "EEG1000[1,2] Fundamentals of Professional
// Development", "EE402A[2]OOP with Embedded Systems", "EE425/EE453[1] Image Processing &
// Analysis (Plus)". This takes it off before the Abbreviations page or the model sees the
// name. It is plain code, not the model's job, because a code always has the same shape, and
// a model asked to drop it could take a word with it or leave part of it behind.
//
// There's no `server-only` and no imports, so the page, the server and a harness all run
// the same function.

/// One module code: EEG1000, MS147A.
const CODE = String.raw`[A-Z]{2,5}\d{2,5}[A-Z]?`;
const CODES = String.raw`${CODE}(?:\/${CODE})*`;

/// A name's leading codes, then the semesters in brackets. With no brackets a space has to
/// follow, so the code is a whole word: "EEG1000 Fundamentals" loses it, "EEG1000X1" doesn't.
const PREFIX = new RegExp(String.raw`^(${CODES})(?:\[[^\]]*\]\s*|\s+)(?=\S)`);

/// A name that is nothing but a code.
const ONLY_CODE = new RegExp(String.raw`^${CODES}(?:\[[^\]]*\])?$`);

/// Where the next module's name starts, in a class two modules share: "CHM1006[1] Inorganic
/// & Physical Chemistry, EEG1017[1] Basic Sciences for Engineers (Physical, Chemical, Life)".
/// It splits only before a bracketed code, so the commas inside "(Physical, Chemical,
/// Life)" stay put.
const NEXT_MODULE = new RegExp(String.raw`,\s*(?=${CODES}\[)`);

/// A whole module code, as the app keys a class by it. An "Orientation MS146" event is keyed
/// "Orientation" there, and isn't a module.
export const MODULE_KEY = new RegExp(String.raw`^${CODE}$`);

/// Whether a name starts with a module code — for text typed as an abbreviation.
export const STARTS_WITH_CODE = new RegExp(String.raw`^${CODE}\b`);

/// DCU's name without its codes. In a shared class's name, `code` picks that module's own
/// part. Without `code`, or when no part is its own, every part is kept, without its codes.
/// Empty when DCU gives the module no name, only a code.
export function stripModuleCode(raw: string, code?: string): string {
  const parts = raw.trim().split(NEXT_MODULE).map(part);
  const own = code ? parts.find((p) => p.codes.includes(code.trim().toUpperCase())) : undefined;
  return own ? own.name : parts.map((p) => p.name).filter(Boolean).join(", ");
}

function part(text: string): { codes: string[]; name: string } {
  const t = text.trim();
  if (ONLY_CODE.test(t)) return { codes: t.split("[")[0].split("/"), name: "" };
  const m = PREFIX.exec(t);
  return m ? { codes: m[1].split("/"), name: t.slice(m[0].length).trim() } : { codes: [], name: t };
}
