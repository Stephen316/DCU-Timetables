import "server-only";
import { classes, weeks } from "@/lib/dcu/timetable";
import { checkChange, hitFindings, removalHits, type TimetableChange } from "@/lib/changes/change";
import type { Finding } from "@/lib/extraction/rotation";
import { resolveCourse } from "@/lib/proposals/catalogue";

/// The teaching weeks the dates fall in, so a removal is checked against those weeks only.
async function weeksFor(dates: string[]): Promise<number[]> {
  const all = await weeks();
  const within = (d: string, first: string) => {
    const t = Date.parse(`${d}T12:00:00Z`) - Date.parse(`${first}T00:00:00Z`);
    return t >= 0 && t < 7 * 86_400_000;
  };
  return [...new Set(dates.flatMap((d) => all.filter((w) => within(d, w.firstDay)).map((w) => w.number)))];
}

/// Everything saving would refuse or warn about, including — for a removal — whether each
/// date has a class to remove. For callers that have already checked the console is open;
/// kept out of the `"use server"` file so it isn't itself a public action.
export async function review(change: TimetableChange): Promise<Finding[]> {
  let course;
  try {
    course = await resolveCourse(change.courseKey);
  } catch {
    return [{ level: "error", message: `DCU's timetable couldn't be reached to check ${change.courseKey}. Try again.` }];
  }
  const findings = checkChange(change, course);
  if (change.kind !== "remove" || findings.some((f) => f.level === "error")) return findings;
  try {
    const found = await classes([change.module], await weeksFor(change.dates));
    return [...findings, ...hitFindings(change, removalHits(change, found))];
  } catch {
    return [...findings, { level: "warn", message: "Couldn't reach DCU's timetable to check the dates have that class." }];
  }
}
