import { Deadline, DeadlineKind, makeDeadline } from '../../core/deadline';

export type JournalTaskType = 'homework' | 'project' | 'quiz' | 'exam' | 'other';

export const JOURNAL_TASK_TYPES: JournalTaskType[] = ['homework', 'project', 'quiz', 'exam', 'other'];

export function journalTaskTypeLabel(type: JournalTaskType, customType?: string): string {
  switch (type) {
    case 'homework':
      return 'Assignment';
    case 'project':
      return 'Project';
    case 'quiz':
      return 'Quiz';
    case 'exam':
      return 'Exam';
    case 'other':
      return customType?.trim() ? customType.trim() : 'Other';
  }
}

export function journalTypeToDeadlineKind(type: JournalTaskType): DeadlineKind {
  switch (type) {
    case 'homework':
      return 'assignment';
    case 'project':
      return 'presentation';
    case 'quiz':
      return 'quiz';
    case 'exam':
      return 'exam';
    case 'other':
      return 'other';
  }
}

export function deadlineKindToJournalType(kind: DeadlineKind): JournalTaskType {
  switch (kind) {
    case 'assignment':
      return 'homework';
    case 'presentation':
    case 'labReport':
      return 'project';
    case 'quiz':
      return 'quiz';
    case 'exam':
      return 'exam';
    case 'other':
      return 'other';
  }
}

export interface StoredJournalItem {
  id: string;
  moduleKey: string;
  title: string;
  kind: DeadlineKind;
  taskType?: JournalTaskType;
  /** Custom task type name when `taskType === 'other'`. */
  customType?: string;
  due: string;
  gradeWeight: number;
  createdAt: string;
}

export interface JournalDeadlineEntry {
  deadline: Deadline;
  isManual: boolean;
  taskType: JournalTaskType;
  typeLabel: string;
  rawManual?: StoredJournalItem;
}

export function toDeadline(item: StoredJournalItem): Deadline | null {
  const due = new Date(item.due);
  if (Number.isNaN(due.getTime())) return null;
  const taskType: JournalTaskType = item.taskType ?? deadlineKindToJournalType(item.kind ?? 'assignment');
  const kind = journalTypeToDeadlineKind(taskType);
  return makeDeadline({
    id: item.id,
    moduleKey: item.moduleKey || 'Personal',
    title: item.title,
    due,
    kind,
    submitterID: 'journal-local',
    submittedAt: new Date(item.createdAt || Date.now()),
    isMine: true,
    myLabel: item.customType?.trim() || null,
    gradeWeight: typeof item.gradeWeight === 'number' ? item.gradeWeight : 0,
  });
}

/**
 * Merges shared/pre-assigned module deadlines and locally stored manual Journal items
 * into a single sorted list of `JournalDeadlineEntry` objects.
 */
export function buildJournalEntries(
  sharedDeadlines: Deadline[],
  storedItems: StoredJournalItem[],
): JournalDeadlineEntry[] {
  const manualEntries: JournalDeadlineEntry[] = [];
  for (const item of storedItems) {
    const deadline = toDeadline(item);
    if (!deadline) continue;
    const taskType = item.taskType ?? deadlineKindToJournalType(deadline.kind);
    manualEntries.push({
      deadline,
      isManual: true,
      taskType,
      typeLabel: journalTaskTypeLabel(taskType, item.customType),
      rawManual: item,
    });
  }

  const sharedEntries: JournalDeadlineEntry[] = sharedDeadlines.map((d) => {
    const taskType = deadlineKindToJournalType(d.kind);
    return {
      deadline: d,
      isManual: false,
      taskType,
      typeLabel: journalTaskTypeLabel(taskType),
    };
  });

  return [...sharedEntries, ...manualEntries].sort(
    (a, b) => a.deadline.due.getTime() - b.deadline.due.getTime(),
  );
}
