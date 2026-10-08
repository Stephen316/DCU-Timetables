"use server";

import { consoleOpen } from "@/lib/auth/gate";
import { courseOptions, resolveCourse, type CourseOption } from "@/lib/proposals/catalogue";

/// The Programme and Module pickers' lists. Both come from DCU for any course but the fixed
/// ones, and both are cached on the server — the course list for a day, a course's modules
/// for an hour — so opening Ask costs DCU nothing after the first time.

type Failed = { ok: false; error: string };

export async function listCourses(): Promise<{ ok: true; courses: CourseOption[] } | Failed> {
  if (!(await consoleOpen())) return { ok: false, error: "The console is locked, or this account isn't an admin." };
  try {
    return { ok: true, courses: await courseOptions() };
  } catch {
    return { ok: false, error: "DCU's timetable didn't answer, so only General Engineering is listed. Reload to try again." };
  }
}

export async function listModules(key: string): Promise<{ ok: true; modules: { code: string; title: string; hint: string }[] } | Failed> {
  if (!(await consoleOpen())) return { ok: false, error: "The console is locked, or this account isn't an admin." };
  try {
    const course = await resolveCourse(key);
    if (!course) return { ok: false, error: `DCU's timetable has no course ${key}.` };
    return {
      ok: true,
      modules: course.modules.map((m) => ({ code: m.code, title: m.title, hint: m.semester ? `Semester ${m.semester}` : "" })),
    };
  } catch {
    return { ok: false, error: `DCU's timetable didn't answer, so ${key}'s modules couldn't be listed. Pick the course again to retry.` };
  }
}
