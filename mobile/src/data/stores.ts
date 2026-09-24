import {
  CancellationReport, CancellationTally, EventVerdict, isReportStance, VerdictState, VERDICT_STATES,
} from '../core/cancellation';
import {
  Deadline, DeadlineConfirmation, DeadlineReportReason, DeadlineRules, DeadlineStanding, isDeadlineKind,
} from '../core/deadline';
import { AccountProfile, makeAccountProfile, parseRole } from '../core/identity';
import { isoSeconds, parseISO } from '../core/time';
import { PostgREST, rows, ServiceError, SupabaseREST, userFacing } from './rest';
import { SignedInUser } from './session';
import { PrefKey, Prefs } from './storage';

// MARK: - Cancellation reports

/** Where cancellation reports are shared between students. */
export interface CancellationStore {
  /** Counts from the server, plus how this person voted. The device never sees who. */
  tallies(keys: string[]): Promise<CancellationTally[]>;
  /**
   * Insert only. Changing your mind is a `withdraw` then a `submit`, because the write path
   * is `ON CONFLICT DO NOTHING` and there is deliberately no UPDATE policy on the table.
   */
  submit(report: CancellationReport): Promise<void>;
  withdraw(eventKey: string, reporterID: string): Promise<void>;
}

export class SupabaseCancellationStore implements CancellationStore {
  private static readonly describe = (status: number) => `Report service returned ${status}.`;

  constructor(private readonly rest: SupabaseREST) {}

  async tallies(keys: string[]): Promise<CancellationTally[]> {
    if (keys.length === 0) return [];
    const json = await this.rest.json('GET', '/rest/v1/cancellation_tallies', SupabaseCancellationStore.describe, {
      query: [
        ['select', 'event_key,report_count,on_count,my_stance'],
        ['event_key', PostgREST.inList(keys)],
      ],
    });
    return rows(json).flatMap((r) =>
      typeof r.event_key === 'string' && typeof r.report_count === 'number'
        ? [{
            eventKey: r.event_key,
            reportCount: r.report_count,
            // Absent on a server that hasn't run the stance migration yet.
            onCount: typeof r.on_count === 'number' ? r.on_count : 0,
            myStance: isReportStance(r.my_stance) ? r.my_stance : null,
          }]
        : [],
    );
  }

  async submit(report: CancellationReport): Promise<void> {
    // `ignore-duplicates` is ON CONFLICT DO NOTHING: a repeat report is genuinely a no-op.
    // `merge-duplicates` would be DO UPDATE, which RLS refuses without an UPDATE policy.
    await this.rest.json('POST', '/rest/v1/cancellation_reports', SupabaseCancellationStore.describe, {
      prefer: 'resolution=ignore-duplicates',
      body: [{ event_key: report.eventKey, reporter_id: report.reporterID, stance: report.stance }],
    });
  }

  async withdraw(eventKey: string, reporterID: string): Promise<void> {
    await this.rest.json('DELETE', '/rest/v1/cancellation_reports', SupabaseCancellationStore.describe, {
      query: [['event_key', `eq.${eventKey}`], ['reporter_id', `eq.${reporterID}`]],
    });
  }
}

/**
 * Used until Supabase is configured. Reports stay on this device, so the threshold will not
 * be reached by one person — the honest behaviour, not a simulated crowd.
 */
export class LocalCancellationStore implements CancellationStore {
  constructor(private readonly prefs: Prefs) {}

  private load(): CancellationReport[] {
    return this.prefs
      .getJSON<{ eventKey: string; reporterID: string; stance?: string; reportedAt: number }[]>(PrefKey.localReports, [])
      .map((r) => ({
        eventKey: r.eventKey,
        reporterID: r.reporterID,
        // Rows written before stances existed are all cancellation reports.
        stance: isReportStance(r.stance) ? r.stance : 'cancelled',
        reportedAt: new Date(r.reportedAt),
      }));
  }

  private save(reports: CancellationReport[]): void {
    this.prefs.setJSON(PrefKey.localReports, reports.map((r) => ({ ...r, reportedAt: r.reportedAt.getTime() })));
  }

  /** Every row here was written by the one person using this device. */
  async tallies(keys: string[]): Promise<CancellationTally[]> {
    const wanted = new Set(keys);
    const byKey = new Map<string, CancellationReport[]>();
    for (const r of this.load()) {
      if (!wanted.has(r.eventKey)) continue;
      byKey.set(r.eventKey, [...(byKey.get(r.eventKey) ?? []), r]);
    }
    return [...byKey].map(([eventKey, list]) => ({
      eventKey,
      reportCount: list.filter((r) => r.stance === 'cancelled').length,
      onCount: list.filter((r) => r.stance === 'on').length,
      myStance: list[list.length - 1]?.stance ?? null,
    }));
  }

  /** Matches the server: one row per person per class, and a repeat is a no-op. */
  async submit(report: CancellationReport): Promise<void> {
    const all = this.load();
    if (all.some((r) => r.eventKey === report.eventKey && r.reporterID === report.reporterID)) return;
    this.save([...all, report]);
  }

  async withdraw(eventKey: string, reporterID: string): Promise<void> {
    this.save(this.load().filter((r) => !(r.eventKey === eventKey && r.reporterID === reporterID)));
  }
}

// MARK: - Deadlines

/** Where deadlines are shared between everyone taking a module. */
export interface DeadlineStore {
  deadlinesForModule(moduleKey: string): Promise<Deadline[]>;
  /** Every module on screen at once — the timetable needs them all to draw its borders. */
  deadlinesForModules(moduleKeys: string[]): Promise<Deadline[]>;
  submit(deadline: Deadline): Promise<void>;
  /** Only the submitter can remove one — enforced by RLS, not just by hiding the button. */
  withdraw(id: string, submitterID: string): Promise<void>;
  /** How many vouched for each deadline, and whether this person did — never who. */
  standings(ids: string[]): Promise<Map<string, DeadlineStanding>>;
  confirm(deadlineID: string, confirmerID: string): Promise<void>;
  unconfirm(deadlineID: string, confirmerID: string): Promise<void>;
  /** Sends the deadline to the console's review queue and hides it from this student. */
  report(deadlineID: string, reason: DeadlineReportReason): Promise<void>;
  /** Stops everything the deadline's author posts reaching this student. */
  hideAuthor(deadlineID: string): Promise<void>;
  /** How many people this student has hidden. A count, not a list. */
  hiddenAuthorCount(): Promise<number>;
  unhideAllAuthors(): Promise<void>;
}

export class SupabaseDeadlineStore implements DeadlineStore {
  private static readonly describe = (status: number) => `Deadline service returned ${status}.`;

  constructor(private readonly rest: SupabaseREST) {}

  deadlinesForModule(moduleKey: string): Promise<Deadline[]> {
    return this.fetch(`eq.${moduleKey}`);
  }

  async deadlinesForModules(moduleKeys: string[]): Promise<Deadline[]> {
    const unique = [...new Set(moduleKeys)].sort();
    if (unique.length === 0) return [];
    return this.fetch(PostgREST.inList(unique));
  }

  /**
   * Reads go to the view, which swaps `submitter_id` for `is_mine`. Nothing prunes the
   * table, so the download is floored at `DeadlineRules.horizon`, the client's own cut-off.
   */
  private async fetch(moduleFilter: string): Promise<Deadline[]> {
    const json = await this.rest.json('GET', '/rest/v1/module_deadlines_public', SupabaseDeadlineStore.describe, {
      query: [
        ['select', 'id,module_key,at_group_key,title,due_at,kind,is_mine,submitted_at'],
        ['module_key', moduleFilter],
        ['due_at', `gte.${isoSeconds(DeadlineRules.horizon())}`],
        ['order', 'due_at.asc'],
      ],
    });
    return rows(json).flatMap((r) => {
      const due = parseISO(r.due_at as string);
      if (typeof r.id !== 'string' || typeof r.module_key !== 'string' || typeof r.title !== 'string' || !due) return [];
      return [{
        id: r.id,
        moduleKey: r.module_key,
        atGroupKey: typeof r.at_group_key === 'string' ? r.at_group_key : null,
        title: r.title,
        due,
        kind: isDeadlineKind(r.kind) ? r.kind : 'other',
        submitterID: '',
        submittedAt: parseISO(r.submitted_at as string) ?? new Date(),
        isMine: r.is_mine === true,
      }];
    });
  }

  async submit(deadline: Deadline): Promise<void> {
    await this.rest.json('POST', '/rest/v1/module_deadlines', SupabaseDeadlineStore.describe, {
      body: [{
        id: deadline.id,
        module_key: deadline.moduleKey,
        at_group_key: deadline.atGroupKey,
        title: deadline.title,
        due_at: isoSeconds(deadline.due),
        kind: deadline.kind,
        submitter_id: deadline.submitterID,
      }],
    });
  }

  async withdraw(id: string, submitterID: string): Promise<void> {
    await this.rest.json('DELETE', '/rest/v1/module_deadlines', SupabaseDeadlineStore.describe, {
      query: [['id', `eq.${id}`], ['submitter_id', `eq.${submitterID}`]],
    });
  }

  async standings(ids: string[]): Promise<Map<string, DeadlineStanding>> {
    const result = new Map<string, DeadlineStanding>();
    if (ids.length === 0) return result;
    const json = await this.rest.json('GET', '/rest/v1/deadline_confirmation_tallies', SupabaseDeadlineStore.describe, {
      query: [['select', 'deadline_id,confirm_count,mine'], ['deadline_id', PostgREST.inList(ids)]],
    });
    for (const r of rows(json)) {
      if (typeof r.deadline_id === 'string' && typeof r.confirm_count === 'number') {
        result.set(r.deadline_id, new DeadlineStanding(r.confirm_count, r.mine === true));
      }
    }
    return result;
  }

  async confirm(deadlineID: string, confirmerID: string): Promise<void> {
    // ON CONFLICT DO NOTHING: confirming twice is a no-op, not a second vote.
    await this.rest.json('POST', '/rest/v1/deadline_confirmations', SupabaseDeadlineStore.describe, {
      prefer: 'resolution=ignore-duplicates',
      body: [{ deadline_id: deadlineID, confirmer_id: confirmerID }],
    });
  }

  async unconfirm(deadlineID: string, confirmerID: string): Promise<void> {
    await this.rest.json('DELETE', '/rest/v1/deadline_confirmations', SupabaseDeadlineStore.describe, {
      query: [['deadline_id', `eq.${deadlineID}`], ['confirmer_id', `eq.${confirmerID}`]],
    });
  }

  async report(deadlineID: string, reason: DeadlineReportReason): Promise<void> {
    await this.rpc('report_deadline', { p_deadline: deadlineID, p_reason: reason });
  }

  async hideAuthor(deadlineID: string): Promise<void> {
    await this.rpc('hide_author_of', { p_deadline: deadlineID });
  }

  async hiddenAuthorCount(): Promise<number> {
    const value = await this.rpc('hidden_author_count', {});
    return typeof value === 'number' ? value : 0;
  }

  async unhideAllAuthors(): Promise<void> {
    await this.rpc('unhide_all_authors', {});
  }

  private rpc(name: string, args: Record<string, string>): Promise<unknown> {
    return this.rest.json('POST', `/rest/v1/rpc/${name}`, SupabaseDeadlineStore.describe, { body: args });
  }
}

/**
 * Used until Supabase is configured. Deadlines stay on this device: you see your own and no
 * one else's, so there is no one else's content to moderate.
 */
export class LocalDeadlineStore implements DeadlineStore {
  constructor(private readonly prefs: Prefs) {}

  private load(): Deadline[] {
    return this.prefs
      .getJSON<(Omit<Deadline, 'due' | 'submittedAt'> & { due: number; submittedAt: number })[]>(PrefKey.localDeadlines, [])
      .map((d) => ({ ...d, due: new Date(d.due), submittedAt: new Date(d.submittedAt), isMine: d.isMine ?? null }));
  }

  private save(list: Deadline[]): void {
    this.prefs.setJSON(
      PrefKey.localDeadlines,
      list.map((d) => ({ ...d, due: d.due.getTime(), submittedAt: d.submittedAt.getTime() })),
    );
  }

  private loadConfirmations(): DeadlineConfirmation[] {
    return this.prefs.getJSON<DeadlineConfirmation[]>(PrefKey.localConfirmations, []);
  }

  async deadlinesForModule(moduleKey: string): Promise<Deadline[]> {
    return DeadlineRules.upcoming(this.load().filter((d) => d.moduleKey === moduleKey));
  }

  async deadlinesForModules(moduleKeys: string[]): Promise<Deadline[]> {
    const wanted = new Set(moduleKeys);
    return DeadlineRules.upcoming(this.load().filter((d) => wanted.has(d.moduleKey)));
  }

  async submit(deadline: Deadline): Promise<void> {
    this.save([...this.load(), deadline]);
  }

  async withdraw(id: string, submitterID: string): Promise<void> {
    this.save(this.load().filter((d) => !(d.id === id && d.submitterID === submitterID)));
  }

  async standings(ids: string[]): Promise<Map<string, DeadlineStanding>> {
    const wanted = new Set(ids);
    const mine = this.loadConfirmations().filter((c) => wanted.has(c.deadlineID));
    const counts = new Map<string, number>();
    for (const c of mine) counts.set(c.deadlineID, (counts.get(c.deadlineID) ?? 0) + 1);
    return DeadlineRules.standingsFromCounts(counts, new Set(mine.map((c) => c.deadlineID)));
  }

  async confirm(deadlineID: string, confirmerID: string): Promise<void> {
    const all = this.loadConfirmations();
    if (all.some((c) => c.deadlineID === deadlineID && c.confirmerID === confirmerID)) return;
    this.prefs.setJSON(PrefKey.localConfirmations, [...all, { deadlineID, confirmerID }]);
  }

  async unconfirm(deadlineID: string, confirmerID: string): Promise<void> {
    this.prefs.setJSON(
      PrefKey.localConfirmations,
      this.loadConfirmations().filter((c) => !(c.deadlineID === deadlineID && c.confirmerID === confirmerID)),
    );
  }

  async report(): Promise<void> {}
  async hideAuthor(): Promise<void> {}
  async hiddenAuthorCount(): Promise<number> { return 0; }
  async unhideAllAuthors(): Promise<void> {}
}

// MARK: - Verdicts

/**
 * Where definitive verdicts on a class are shared. Reading is open to everyone; writing is
 * refused by the database for anyone who isn't trusted, so RLS is the gate.
 */
export interface VerdictStore {
  verdicts(keys: string[]): Promise<EventVerdict[]>;
  /** Posts or replaces the verdict on one class. */
  set(verdict: EventVerdict, moduleKey: string, decidedBy: string): Promise<void>;
  /** Withdraws one. Admin-only in the database. */
  clear(eventKey: string): Promise<void>;
}

export class SupabaseVerdictStore implements VerdictStore {
  /** 401/403 is the ordinary answer for a student tapping a button they shouldn't have seen. */
  private static readonly describe = (status: number) =>
    status === 401 || status === 403
      ? "You don't have permission to decide this."
      : `The verdict service returned ${status}.`;

  constructor(private readonly rest: SupabaseREST) {}

  async verdicts(keys: string[]): Promise<EventVerdict[]> {
    if (keys.length === 0) return [];
    const json = await this.rest.json('GET', '/rest/v1/event_verdicts', SupabaseVerdictStore.describe, {
      query: [
        ['select', 'event_key,state,note,room_override,start_override,decided_by_label,decided_at'],
        ['event_key', PostgREST.inList(keys)],
      ],
    });
    // An unknown state is dropped rather than guessed at: a future 'rescheduled' rendered
    // as "cancelled" would be worse than showing nothing.
    return rows(json).flatMap((r) => {
      if (typeof r.event_key !== 'string' || !VERDICT_STATES.includes(r.state as VerdictState)) return [];
      return [{
        eventKey: r.event_key,
        state: r.state as VerdictState,
        note: typeof r.note === 'string' ? r.note : null,
        roomOverride: typeof r.room_override === 'string' ? r.room_override : null,
        startOverride: parseISO(r.start_override as string),
        decidedByLabel: typeof r.decided_by_label === 'string' ? r.decided_by_label : null,
        decidedAt: parseISO(r.decided_at as string) ?? new Date(),
      }];
    });
  }

  async set(verdict: EventVerdict, moduleKey: string, decidedBy: string): Promise<void> {
    const row: Record<string, string> = {
      event_key: verdict.eventKey,
      state: verdict.state,
      decided_by: decidedBy,
      module_key: moduleKey,
    };
    if (verdict.note != null) row.note = verdict.note;
    if (verdict.roomOverride != null) row.room_override = verdict.roomOverride;
    if (verdict.decidedByLabel != null) row.decided_by_label = verdict.decidedByLabel;
    if (verdict.startOverride) row.start_override = isoSeconds(verdict.startOverride);
    // Changing your mind must replace the row, not fail on its primary key.
    await this.rest.json('POST', '/rest/v1/event_verdicts', SupabaseVerdictStore.describe, {
      prefer: 'resolution=merge-duplicates',
      body: [row],
    });
  }

  async clear(eventKey: string): Promise<void> {
    await this.rest.json('DELETE', '/rest/v1/event_verdicts', SupabaseVerdictStore.describe, {
      query: [['event_key', `eq.${eventKey}`]],
    });
  }
}

/** Used until Supabase is configured: no authority to consult, so nothing persists. */
export class LocalVerdictStore implements VerdictStore {
  private readonly stored = new Map<string, EventVerdict>();
  async verdicts(keys: string[]): Promise<EventVerdict[]> {
    return keys.flatMap((k) => (this.stored.has(k) ? [this.stored.get(k)!] : []));
  }
  async set(verdict: EventVerdict): Promise<void> {
    this.stored.set(verdict.eventKey, verdict);
  }
  async clear(eventKey: string): Promise<void> {
    this.stored.delete(eventKey);
  }
}

// MARK: - The account's own profile

export interface ProfileStore {
  /** The signed-in account's row, or null when there isn't one to read. */
  myProfile(): Promise<AccountProfile | null>;
  /** Records the student number. Set once — after that only an admin can change it. */
  setStudentID(number: string): Promise<void>;
  /** Deletes the account for good. Contributions survive with the link broken. */
  deleteAccount(): Promise<void>;
}

export class SupabaseProfileStore implements ProfileStore {
  private static readonly describe = (status: number) => `The server returned ${status}.`;

  constructor(private readonly rest: SupabaseREST) {}

  async myProfile(): Promise<AccountProfile | null> {
    const uid = this.rest.session.userID;
    if (!uid) throw userFacing("You're not signed in.");
    const json = await this.rest.json('GET', '/rest/v1/profiles', SupabaseProfileStore.describe, {
      query: [['select', 'id,role,pi,display_name,banned_until,student_id'], ['id', `eq.${uid}`]],
    });
    // RLS returns an empty array rather than an error when a row isn't readable, so "no
    // row" and "not allowed" look the same — both mean "no profile", the safe reading.
    const row = rows(json)[0];
    if (!row || typeof row.id !== 'string') return null;
    return {
      id: row.id,
      role: parseRole(row.role) ?? 'student',
      pi: typeof row.pi === 'string' ? row.pi : null,
      displayName: typeof row.display_name === 'string' ? row.display_name : null,
      bannedUntil: parseISO(row.banned_until as string),
      studentID: typeof row.student_id === 'string' ? row.student_id : null,
    };
  }

  async setStudentID(number: string): Promise<void> {
    if (!this.rest.session.userID) throw userFacing("You're not signed in.");
    const response = await this.rest.request('POST', '/rest/v1/rpc/set_student_id', {
      body: { p_student_id: number },
    });
    if (response.ok) return;
    // The function refuses with an exception ("your student ID is already set — ask an
    // admin to change it"), which PostgREST returns as a 400 carrying that sentence.
    if (response.status === 400) {
      const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
      if (typeof body?.message === 'string' && body.message.length > 0) {
        throw userFacing(body.message[0].toUpperCase() + body.message.slice(1));
      }
    }
    throw new ServiceError(response.status, SupabaseProfileStore.describe(response.status));
  }

  async deleteAccount(): Promise<void> {
    // An anon key can't delete from auth.users, so this goes through the `security
    // definer` RPC, which deletes only `auth.uid()`'s own row.
    await this.rest.json('POST', '/rest/v1/rpc/delete_own_account', SupabaseProfileStore.describe, { body: {} });
  }
}

/**
 * Used until Supabase is configured. Reports the account as a plain student — the honest
 * answer when there is no server to ask.
 */
export class LocalProfileStore implements ProfileStore {
  constructor(private readonly user: SignedInUser) {}
  async myProfile(): Promise<AccountProfile | null> {
    const current = this.user.current;
    return current ? makeAccountProfile(current.id) : null;
  }
  async setStudentID(): Promise<void> {}
  async deleteAccount(): Promise<void> {}
}
