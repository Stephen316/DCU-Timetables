import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cancellationEventKey, createStudentDataService } from "./data";

const category = { identity: "course-1", name: "CASE1 (Computing)", categoryTypeIdentity: "241e4d36-60e0-49f8-b27e-99416745d98d" };
const week = { number: 2, label: "2", firstDay: "2026-09-14T00:00:00.000Z" };
const viewOptions = {
  Days: [{ Name: "Monday", DayOfWeek: 1 }],
  Weeks: [{ WeekNumber: 2, WeekLabel: "2", FirstDayInWeek: "2026-09-14T00:00:00+00:00" }],
};
const event = {
  Identity: "event-1", Name: "EEG1002[1]OC/P1/02 Cohort A",
  StartDateTime: "2026-09-15T09:00:00+00:00", EndDateTime: "2026-09-15T10:00:00+00:00",
  EventType: "On Campus", Location: "GLA.HG22",
  ExtraProperties: [{ Name: "Module Name", Value: "Programming" }],
};

function fixture() {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  } satisfies Storage;
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("ViewOptions")) return Response.json(viewOptions);
    if (url.includes("Categories/Events/Filter")) {
      const body = JSON.parse(String(init?.body));
      expect(body.ViewOptions).toMatchObject({ Days: viewOptions.Days, Weeks: viewOptions.Weeks });
      expect(body.ViewOptions.TimePeriods).toHaveLength(1);
      expect(body.ViewOptions.DatePeriods).toHaveLength(1);
      return Response.json({ CategoryEvents: [{ Results: [event] }] });
    }
    if (url.includes("FilterWithCache")) {
      expect(new URL(url).searchParams.get("query")).toBe("CASE");
      expect(JSON.parse(String(init?.body))).toEqual([]);
      return Response.json({ Results: [{ Identity: category.identity, Name: category.name }] });
    }
    throw new Error(`Unexpected URL ${url}`);
  });
  const rpc = vi.fn(async () => ({ data: "A12345678", error: null }));
  const client = { rpc } as unknown as SupabaseClient;
  const service = createStudentDataService({ supabase: client, storage, fetcher: fetcher as typeof fetch });
  return { service, fetcher, rpc };
}

describe("student timetable services", () => {
  it("searches via query string with an empty parent filter", async () => {
    const { service } = fixture();
    expect(await service.searchProgrammes("CASE")).toEqual([category]);
  });

  it("fetches a complete DCU view, maps classes, and opens the cached week offline", async () => {
    const { service, fetcher } = fixture();
    expect((await service.weekCalendar()).weeks).toEqual([week]);
    const classes = await service.events(category, [week]);
    expect(classes).toHaveLength(1);
    expect(classes[0]).toMatchObject({ moduleCode: "EEG1002", locations: ["GLA.HG22"], moduleName: "Programming" });
    expect(cancellationEventKey(classes[0])).toBe(`${event.Name}|2026-09-15T09:00:00Z`);
    fetcher.mockRejectedValue(new Error("offline"));
    expect((await service.events(category, [week]))[0].id).toBe("event-1");
    expect(service.cachedEvents(category.identity, week.number)?.offline).toBe(true);
  });

  it("rejects an invalid student ID before calling the one-time server RPC", async () => {
    const { service, rpc } = fixture();
    await expect(service.setStudentNumber("1234")).rejects.toThrow(/one letter and eight digits/i);
    expect(rpc).not.toHaveBeenCalled();
    expect(await service.setStudentNumber(" a12345678 ")).toBe("A12345678");
    expect(rpc).toHaveBeenCalledWith("set_student_id", { p_student_id: "A12345678" });
  });
});
