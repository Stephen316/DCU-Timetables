import "server-only";
import { unstable_cache } from "next/cache";
import { MODULE_KEY } from "@/lib/abbreviations/names";

// DCU's public MyTimetable API — the one the app reads — trimmed to what the console needs:
// the teaching weeks, and one programme's classes for a week. A port of
// mobile/src/data/dcuApi.ts; docs/API.md has the endpoint notes.
//
// Everything here is public, anonymous, and has no personal data in it.
//
// DCU's API is slow and uneven — one week of one programme took 0.6 s once and 3.5 s the
// next, measured 24 Sep 2026 — and a page asked it again on every click. So answers are
// cached on the server: a module's identity for a week (it never changes), a week's classes
// for ten minutes (DCU edits its timetable rarely, and a console that shows a change ten
// minutes late is fine where one that takes four seconds per click is not).

const API = "https://scientia-eu-v4-api-d1-03.azurewebsites.net/api";
const INSTITUTION = "a1fdee6b-68eb-47b8-b2ac-a4c60c8e6177";
const MODULE_TYPE = "525fe79b-73c3-4b5c-8186-83c652b3adcc";

const HEADERS = {
  Authorization: "Anonymous",
  Accept: "application/json",
  Origin: "https://mytimetable.dcu.ie",
  Referer: "https://mytimetable.dcu.ie/",
};

export type Week = { number: number; label: string; firstDay: string /* yyyy-mm-dd, Dublin */ };

/// One class as the console shows it. Times are Dublin clock times, which is what a
/// student reads and what a change is written in.
export type DcuClass = {
  module: string;
  /// The activity code without its cohort or week suffix: EEG1002[1]OC/P1/02.
  code: string;
  kind: string;
  title: string | null;
  date: string;   // yyyy-mm-dd
  day: string;    // Mon
  start: string;  // HH:mm
  end: string;
  rooms: string[];
};

type WeekDTO = { WeekNumber: number; WeekLabel: string; FirstDayInWeek: string };
type ViewOptions = { Weeks: WeekDTO[]; Days: unknown[] };

async function call<T>(path: string, init?: { body: unknown; query?: Record<string, string> }): Promise<T> {
  const url = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries(init?.query ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method: init ? "POST" : "GET",
    headers: init ? { ...HEADERS, "Content-Type": "application/json" } : HEADERS,
    body: init ? JSON.stringify(init.body) : undefined,
    // The week list is a GET and caches here. The POSTs don't — fetch won't cache a POST
    // — so their answers are cached by `unstable_cache` below instead.
    next: { revalidate: init ? 0 : 3600 },
  });
  if (!res.ok) throw new Error(`DCU's timetable returned ${res.status}.`);
  return res.json() as Promise<T>;
}

const viewOptions = () => call<ViewOptions>(`Public/ViewOptions/${INSTITUTION}`);

export async function weeks(): Promise<Week[]> {
  const vo = await viewOptions();
  return vo.Weeks.map((w) => ({ number: w.WeekNumber, label: w.WeekLabel, firstDay: dublin(w.FirstDayInWeek).date }));
}

/// Thrown rather than returned so `unstable_cache` doesn't keep a miss: a module DCU's
/// search briefly failed to find would otherwise stay missing for the whole week.
class ModuleNotFound extends Error {}

const cachedModuleIdentity = unstable_cache(lookupModule, ["dcu-module-identity"], { revalidate: 7 * 86_400 });

async function moduleIdentity(code: string): Promise<string | null> {
  try {
    return await cachedModuleIdentity(code);
  } catch (e) {
    if (e instanceof ModuleNotFound) return null;
    throw e;
  }
}

/// The module whose name starts with exactly this code. Never the search's best guess: a
/// mistyped code would fetch — and check a change against — another module's classes.
async function lookupModule(code: string): Promise<string> {
  const res = await call<{ Results: { Identity: string; Name: string }[] }>(
    `Public/CategoryTypes/${MODULE_TYPE}/Categories/FilterWithCache/${INSTITUTION}`,
    { body: [], query: { query: code, itemsPerPage: "50", pageNumber: "1", returnOccurrences: "false" } },
  );
  const wanted = code.trim().toUpperCase();
  const exact = res.Results.find((r) => {
    const name = r.Name.trim().toUpperCase();
    // EEG1001 must not match EEG10012: the code has to end at a non-alphanumeric.
    return name.startsWith(wanted) && !/[A-Z0-9]/.test(name.charAt(wanted.length));
  });
  if (!exact) throw new ModuleNotFound(code);
  return exact.Identity;
}

/// Every class of these modules in the given weeks.
export async function classes(moduleCodes: string[], weekNumbers: number[]): Promise<DcuClass[]> {
  return cachedClasses([...moduleCodes].sort(), [...weekNumbers].sort((a, b) => a - b));
}

const cachedClasses = unstable_cache(fetchClasses, ["dcu-classes"], { revalidate: 600 });

async function fetchClasses(moduleCodes: string[], weekNumbers: number[]): Promise<DcuClass[]> {
  const vo = await viewOptions();
  const wanted = vo.Weeks.filter((w) => weekNumbers.includes(w.WeekNumber)).sort((a, b) => a.WeekNumber - b.WeekNumber);
  if (!wanted.length || !moduleCodes.length) return [];
  const ids = (await Promise.all(moduleCodes.map(moduleIdentity))).filter((x): x is string => !!x);
  if (!ids.length) return [];

  const lastStart = new Date(wanted[wanted.length - 1].FirstDayInWeek);
  const end = new Date(lastStart.getTime() + 7 * 86_400_000).toISOString().replace(".000Z", "+00:00");
  const res = await call<{ CategoryEvents?: { Results?: EventDTO[] }[] }>(
    `Public/CategoryTypes/Categories/Events/Filter/${INSTITUTION}`,
    {
      body: {
        // All four are required; leaving any out returns nothing (docs/API.md).
        ViewOptions: {
          Days: vo.Days,
          Weeks: wanted,
          TimePeriods: [{ Description: "All Day", StartTime: "00:00", EndTime: "23:59", IsDefault: true }],
          DatePeriods: [{ Description: "Range", StartDateTime: wanted[0].FirstDayInWeek, EndDateTime: end, IsDefault: true, Type: null }],
        },
        CategoryTypesWithIdentities: [{ CategoryTypeIdentity: MODULE_TYPE, CategoryIdentities: ids }],
        FetchBookings: false,
        FetchPersonalEvents: false,
        PersonalIdentities: [],
      },
    },
  );

  const out: DcuClass[] = [];
  const seen = new Set<string>();
  for (const e of (res.CategoryEvents ?? []).flatMap((g) => g.Results ?? [])) {
    if (!e.Name || !e.StartDateTime || !e.EndDateTime) continue;
    const code = activityCode(e.Name);
    const module = code.split("[")[0];
    const start = dublin(e.StartDateTime);
    // A class shared by two of the modules asked for comes back once per module.
    const key = `${code}|${e.StartDateTime}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      module,
      code,
      kind: e.EventType ?? "",
      title: e.ExtraProperties?.find((p) => p.Name === "Module Name")?.Value ?? null,
      date: start.date,
      day: start.day,
      start: start.time,
      end: dublin(e.EndDateTime).time,
      rooms: (e.Location ?? "").split(",").map((r) => r.trim()).filter(Boolean),
    });
  }
  return out.sort((a, b) => `${a.date}${a.start}${a.code}`.localeCompare(`${b.date}${b.start}${b.code}`));
}

const PROGRAMME_TYPE = "241e4d36-60e0-49f8-b27e-99416745d98d";

/// One course code in DCU's programme list, with every variant DCU files under it: "AC3" is
/// two programmes there (AC3 and its AT stream), "BED2" is thirty-six. The app knows a
/// student's programme by its code alone, so a course here is a code too.
export type DcuProgramme = { code: string; names: string[]; identities: string[] };

/// Every programme on DCU's timetable, grouped by code — about 490 codes from 940 entries,
/// measured 8 Oct 2026. Cached for a day: the list changes once a year.
export async function programmeCatalogue(): Promise<DcuProgramme[]> {
  return cachedCatalogue();
}

const cachedCatalogue = unstable_cache(fetchCatalogue, ["dcu-programme-catalogue"], { revalidate: 86_400 });

type Page = { Results?: { Identity: string; Name: string }[]; TotalPages?: number };

/// DCU serves the list 20 at a time, whatever page size is asked for. Asked for all 47 pages
/// at once it timed out on 6 of them (8 Oct 2026), so pages go four at a time, each tried
/// three times. A list with a page missing is never returned: a course absent from the
/// picker looks like a course that doesn't exist.
async function fetchCatalogue(): Promise<DcuProgramme[]> {
  const page = async (n: number): Promise<Page> => {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await call<Page | string>(
          `Public/CategoryTypes/${PROGRAMME_TYPE}/Categories/FilterWithCache/${INSTITUTION}`,
          { body: [], query: { query: "", itemsPerPage: "20", pageNumber: String(n), returnOccurrences: "false" } },
        );
        // A timeout comes back as 200 with a string body, not as an error status.
        if (typeof res === "object" && Array.isArray(res.Results)) return res;
        throw new Error(`DCU's timetable didn't return page ${n} of its programmes.`);
      } catch (e) {
        if (attempt >= 3) throw e;
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
  };

  const first = await page(1);
  const total = first.TotalPages ?? 1;
  const results = [...(first.Results ?? [])];
  const rest = Array.from({ length: total - 1 }, (_, i) => i + 2);
  for (let i = 0; i < rest.length; i += 4) {
    for (const p of await Promise.all(rest.slice(i, i + 4).map(page))) results.push(...(p.Results ?? []));
  }

  const byCode = new Map<string, DcuProgramme>();
  for (const r of results) {
    const code = r.Name.trim().split(/\s+/)[0].toUpperCase();
    const entry = byCode.get(code) ?? { code, names: [], identities: [] };
    if (!entry.identities.includes(r.Identity)) {
      entry.identities.push(r.Identity);
      entry.names.push(r.Name.trim());
    }
    byCode.set(code, entry);
  }
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}

/// Every module on a programme's timetable for the year, with its name exactly as DCU gives
/// it, codes and all. These are the modules a student of the programme sees on the app's
/// week grid. That includes some a course's own list lacks: EEG1's first-year chemistry
/// classes are CHM1006's, shared with EEG1017. A week not yet published contributes
/// nothing, so a semester-2 module appears here only once DCU publishes semester 2.
///
/// The whole year is one request: 226 classes in 0.7 s for ECE1, measured 28 Sep 2026.
export async function programmeModules(programmeCode: string): Promise<{ code: string; name: string }[]> {
  return cachedProgrammeModules(programmeCode.trim().toUpperCase());
}

const cachedProgrammeModules = unstable_cache(fetchProgrammeModules, ["dcu-programme-modules"], { revalidate: 3600 });

async function fetchProgrammeModules(programmeCode: string): Promise<{ code: string; name: string }[]> {
  const identities = await identitiesFor(programmeCode);
  if (!identities.length) throw new Error(`DCU's timetable has no programme ${programmeCode}.`);

  const vo = await viewOptions();
  if (!vo.Weeks.length) return [];
  const lastStart = new Date(vo.Weeks[vo.Weeks.length - 1].FirstDayInWeek);
  const end = new Date(lastStart.getTime() + 7 * 86_400_000).toISOString().replace(".000Z", "+00:00");
  const res = await call<{ CategoryEvents?: { Results?: EventDTO[] }[] }>(
    `Public/CategoryTypes/Categories/Events/Filter/${INSTITUTION}`,
    {
      body: {
        ViewOptions: {
          Days: vo.Days,
          Weeks: vo.Weeks,
          TimePeriods: [{ Description: "All Day", StartTime: "00:00", EndTime: "23:59", IsDefault: true }],
          DatePeriods: [{ Description: "Range", StartDateTime: vo.Weeks[0].FirstDayInWeek, EndDateTime: end, IsDefault: true, Type: null }],
        },
        CategoryTypesWithIdentities: [{ CategoryTypeIdentity: PROGRAMME_TYPE, CategoryIdentities: identities }],
        FetchBookings: false,
        FetchPersonalEvents: false,
        PersonalIdentities: [],
      },
    },
  );

  // The app files a class under the module its activity code starts with, so this does too.
  const names = new Map<string, string>();
  for (const e of (res.CategoryEvents ?? []).flatMap((g) => g.Results ?? [])) {
    if (!e.Name) continue;
    const code = activityCode(e.Name).split("[")[0];
    const name = e.ExtraProperties?.find((p) => p.Name === "Module Name")?.Value?.trim();
    if (MODULE_KEY.test(code) && name && !names.has(code)) names.set(code, name);
  }
  return [...names].map(([code, name]) => ({ code, name })).sort((a, b) => a.code.localeCompare(b.code));
}

/// Every variant of a code — a student on any of BED2's thirty-six sees the course's classes.
/// From the catalogue when it can be had; otherwise one search, which returns at most 20.
async function identitiesFor(programmeCode: string): Promise<string[]> {
  try {
    return (await programmeCatalogue()).find((p) => p.code === programmeCode)?.identities ?? [];
  } catch {
    const found = await call<{ Results: { Identity: string; Name: string }[] }>(
      `Public/CategoryTypes/${PROGRAMME_TYPE}/Categories/FilterWithCache/${INSTITUTION}`,
      { body: [], query: { query: programmeCode, itemsPerPage: "50", pageNumber: "1", returnOccurrences: "false" } },
    );
    // "ECE1 (Engineering-1)" is ECE1's; "MECE1" is another programme the search also returns.
    return found.Results.filter((r) => r.Name.trim().split(/\s+/)[0].toUpperCase() === programmeCode).map((r) => r.Identity);
  }
}

type EventDTO = {
  Name?: string; StartDateTime?: string; EndDateTime?: string; EventType?: string; Location?: string;
  ExtraProperties?: { Name?: string; Value?: string }[];
};

/// "EEG1002[1]OC/L1/01 <2, 4, 6>" → "EEG1002[1]OC/L1/01". The same rule the app applies
/// (mobile/src/core/activityCode.ts), so a code picked here matches a class on the phone.
export function activityCode(name: string): string {
  return name.trim().split(/\s+/)[0].replace(/,+$/, "");
}

const parts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
});

/// An API timestamp (true UTC) as a Dublin date, weekday and clock time.
export function dublin(iso: string): { date: string; day: string; time: string } {
  const p = Object.fromEntries(parts.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, day: p.weekday, time: `${p.hour}:${p.minute}` };
}
