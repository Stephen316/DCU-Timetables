import "server-only";
import { PROGRAMMES, type Programme } from "@/lib/proposals/courses";
import { programmeModules } from "@/lib/dcu/timetable";
import { stripModuleCode } from "./names";

/// A module as the Abbreviations page and the model see it: DCU's name, with the code
/// already taken off. The code is the module's key, and it tells apart modules DCU gives
/// the same name (EEG1010, EEG1011 and EEG1018 are all "Engineering Mathematics IV").
export type CourseModule = { code: string; name: string };

export type Course = {
  key: string;
  name: string;
  /// The DCU programmes the course stands for: ECE1, BMED1 and the rest.
  covers: string[];
  modules: CourseModule[];
  /// Why the list is only the console's own, when DCU couldn't be reached.
  failed: string | null;
};

export async function courses(): Promise<Course[]> {
  return Promise.all(PROGRAMMES.map(course));
}

/// The modules on the timetables of the course's programmes, which are what its students see
/// on the week grid. Then the ones on the course's own list that DCU hasn't published yet,
/// such as semester 2's before it is out.
export async function course(p: Programme): Promise<Course> {
  const raw = new Map<string, string>();
  const read = await Promise.allSettled(p.covers.map((c) => programmeModules(c.code)));
  for (const r of read) {
    if (r.status !== "fulfilled") continue;
    for (const m of r.value) if (!raw.has(m.code)) raw.set(m.code, m.name);
  }
  for (const m of p.modules) if (!raw.has(m.code)) raw.set(m.code, m.title);

  const failed = read.length > 0 && read.every((r) => r.status === "rejected")
    ? "Couldn't reach DCU's timetable, so this is the console's own list of the course's modules. It uses the console's copy of each name and leaves out any module DCU shares with another course."
    : null;
  return {
    key: p.key,
    name: p.name,
    covers: p.covers.map((c) => c.code),
    modules: [...raw]
      .map(([code, name]) => ({ code, name: stripModuleCode(name, code) }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    failed,
  };
}
