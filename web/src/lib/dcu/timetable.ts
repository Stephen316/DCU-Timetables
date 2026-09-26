import "server-only";
import { unstable_cache } from "next/cache";

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

const moduleIdentity = unstable_cache(lookupModule, ["dcu-module-identity"], { revalidate: 7 * 86_400 });

async function lookupModule(code: string): Promise<string | null> {
  const res = await call<{ Results: { Identity: string; Name: string }[] }>(
    `Public/CategoryTypes/${MODULE_TYPE}/Categories/FilterWithCache/${INSTITUTION}`,
    { body: [], query: { query: code, itemsPerPage: "50", pageNumber: "1", returnOccurrences: "false" } },
  );
  const exact = res.Results.find((r) => r.Name.toUpperCase().startsWith(code.toUpperCase()));
  return (exact ?? res.Results[0])?.Identity ?? null;
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
