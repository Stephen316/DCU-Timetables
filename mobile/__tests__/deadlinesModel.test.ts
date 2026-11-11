import { DeadlineDraft, DeadlineRules, DETAILS_LIMIT, LABEL_LIMIT, makeDeadline, TITLE_LIMIT } from '../src/core/deadline';
import { cohortText } from '../src/core/activityCode';
import { groupKeyOf, groupLabelOf } from '../src/core/timetableEvent';
import { createServices } from '../src/data/services';
import { MemoryKV } from '../src/data/storage';
import { DeadlinesModel } from '../src/features/deadlines/DeadlinesModel';
import { canEdit, moderationFor } from '../src/features/deadlines/Moderation';
import { at, event } from './helpers';

const noSecrets = { get: async () => null, set: async () => {}, remove: async () => {} };
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000);

describe('Deadlines module filter', () => {
  async function loaded() {
    const services = await createServices({ kv: new MemoryKV(), secrets: noSecrets, env: {}, alerts: null });
    for (const [moduleKey, title, days] of [['CA116', 'Lab 1', 2], ['MS121', 'Quiz', 3], ['CA116', 'Project', 20]] as const) {
      await services.deadlines.submit(makeDeadline({ moduleKey, title, due: inDays(days), submitterID: 'me' }));
    }
    const model = new DeadlinesModel(services);
    await model.load(['CA116', 'MS121']);
    return { services, model };
  }
  const titles = (model: DeadlinesModel) => model.sections.flatMap((s) => s.deadlines.map((d) => d.title));

  test('offers each module that has something due, and shows every module until one is chosen', async () => {
    const { model } = await loaded();
    expect(model.modulesWithDeadlines.sort()).toEqual(['CA116', 'MS121']);
    expect(model.moduleFilter).toBeNull();
    expect(titles(model)).toEqual(['Lab 1', 'Quiz', 'Project']);
  });

  test("choosing a module shows only its deadlines, still soonest first, and counts only them", async () => {
    const { model } = await loaded();
    model.showModule('CA116');
    expect(titles(model)).toEqual(['Lab 1', 'Project']);
    expect(model.total).toBe(2);
    // The other choices stay on offer while one is chosen.
    expect(model.modulesWithDeadlines.sort()).toEqual(['CA116', 'MS121']);
    model.showModule(null);
    expect(titles(model)).toEqual(['Lab 1', 'Quiz', 'Project']);
  });

  test("adding one for another module shows every module, so the new one isn't hidden", async () => {
    const { model } = await loaded();
    model.showModule('CA116');
    const adding = model.add({ title: 'Problem sheet', kind: 'assignment', due: inDays(4), gradeWeight: 0 }, { moduleKey: 'MS121', atGroupKey: null, label: '' });
    expect(model.moduleFilter).toBeNull();
    expect(titles(model)).toContain('Problem sheet');
    await adding;
    expect(titles(model)).toEqual(['Lab 1', 'Quiz', 'Problem sheet', 'Project']);
  });

  test('adding one for the module being shown keeps that module chosen', async () => {
    const { model } = await loaded();
    model.showModule('CA116');
    await model.add({ title: 'Lab 2', kind: 'labReport', due: inDays(4), gradeWeight: 0 }, { moduleKey: 'CA116', atGroupKey: null, label: '' });
    expect(model.moduleFilter).toBe('CA116');
    expect(titles(model)).toEqual(['Lab 1', 'Lab 2', 'Project']);
  });

  test('a reload keeps the choice, and lets go of a module left with nothing due', async () => {
    const { services, model } = await loaded();
    model.showModule('MS121');
    await model.reload();
    expect(titles(model)).toEqual(['Quiz']);
    const [quiz] = model.sections[0].deadlines;
    await services.deadlines.withdraw(quiz.id, 'me');
    await model.reload();
    expect(model.moduleFilter).toBeNull();
    expect(titles(model)).toEqual(['Lab 1', 'Project']);
  });
});

describe('Adding a deadline from the Deadlines tab', () => {
  const now = at(2026, 11, 3, 12);
  const draft = (over: Partial<DeadlineDraft> = {}): DeadlineDraft => ({
    moduleKey: 'CA116', title: 'Lab 2', due: at(2026, 11, 10, 9), weightText: '', label: '', ...over,
  });

  test('a filled-in draft has nothing wrong with it', () => {
    expect(DeadlineRules.draftProblems(draft(), now)).toEqual({});
  });

  test('asks for a module, a title, a later time and a whole-number weight', () => {
    const problems = DeadlineRules.draftProblems(draft({ moduleKey: null, title: '   ', due: at(2026, 11, 3, 11), weightText: '101' }), now);
    expect(Object.keys(problems).sort()).toEqual(['due', 'module', 'title', 'weight']);
  });

  test("holds titles and the student's own name to the server's limits", () => {
    expect(DeadlineRules.draftProblems(draft({ title: 'x'.repeat(TITLE_LIMIT) }), now).title).toBeUndefined();
    expect(DeadlineRules.draftProblems(draft({ title: 'x'.repeat(TITLE_LIMIT + 1) }), now).title).toBeDefined();
    expect(DeadlineRules.draftProblems(draft({ label: 'x'.repeat(LABEL_LIMIT + 1) }), now).label).toBeDefined();
    expect(DeadlineRules.draftProblems(draft({ weightText: '0' }), now).weight).toBeUndefined();
  });

  test("offers the student's own modules by name, each with its classes once", () => {
    const events = [
      event('CA116[1]OC/L1/01', at(2026, 11, 3, 9)),
      event('CA116[1]OC/L1/01', at(2026, 11, 10, 9)),
      event('CA116[1]OC/P1/02', at(2026, 11, 4, 14)),
      event('MS121[1]OC/L1/01', at(2026, 11, 5, 10)),
    ];
    const names: Record<string, string> = { CA116: 'Computing', MS121: 'Algebra' };
    const choices = DeadlineRules.moduleChoices(events, (key) => names[key] ?? key);
    expect(choices.map((c) => c.name)).toEqual(['Algebra', 'Computing']);
    expect(choices[1].classes.map((c) => c.groupKey).sort()).toEqual([groupKeyOf(events[0]), groupKeyOf(events[2])].sort());
  });

  test('lists a module\'s classes by kind, lectures first, without a group number nobody needs', () => {
    const events = [
      event('EM113[1]OC/T1/01 <02-06, 08-12>', at(2026, 11, 6, 11)),
      event('EM113[1]OC/L2/01', at(2026, 11, 4, 9)),
      event('EM113[1]OC/L1/01', at(2026, 11, 3, 9)),
      event('EM113[1]OC/P1/02', at(2026, 11, 5, 14)),
      event('EM113[1]OC/P1/03', at(2026, 11, 7, 14)),
    ];
    const [choice] = DeadlineRules.moduleChoices(events, () => 'Engineering Mathematics I');
    expect(choice.classes.map((c) => [c.kind, c.short])).toEqual([
      ['L', 'L1'], ['L', 'L2'], ['T', 'T1 · Weeks 2–6, 8–12'], ['P', 'P1 · Grp 02'], ['P', 'P1 · Grp 03'],
    ]);
    expect(choice.classes[2].label).toBe('Tutorial T1 · Weeks 2–6, 8–12');
  });

  test('reads a week-range cohort as weeks, and leaves any other cohort as it is', () => {
    expect(cohortText('<02-06, 08-12>')).toBe('Weeks 2–6, 8–12');
    expect(cohortText('<07>')).toBe('Week 7');
    expect(cohortText('Surname A - M')).toBe('Surname A - M');
    // The class page's heading reads the same way.
    expect(groupLabelOf(event('EM113[1]OC/T1/01 <02-06, 08-12>', at(2026, 11, 6, 11)))).toBe('Tutorial T1 · Grp 01 · Weeks 2–6, 8–12');
  });

  test('a new deadline is in the list straight away, pinned where chosen, with its own name', async () => {
    const services = await createServices({ kv: new MemoryKV(), secrets: noSecrets, env: {}, alerts: null });
    const model = new DeadlinesModel(services);
    await model.load(['CA116']);
    const adding = model.add(
      { title: 'Lab 2', kind: 'labReport', due: inDays(5), gradeWeight: 10 },
      { moduleKey: 'CA116', atGroupKey: 'CA116|P1|02|', label: 'Sorting lab' },
    );
    expect(model.sections.flatMap((s) => s.deadlines).map((d) => d.title)).toEqual(['Lab 2']);
    await adding;
    const [saved] = model.sections.flatMap((s) => s.deadlines);
    expect(saved).toMatchObject({ title: 'Lab 2', moduleKey: 'CA116', atGroupKey: 'CA116|P1|02|', gradeWeight: 10, myLabel: 'Sorting lab' });
    expect(model.isMine(saved)).toBe(true);
    expect(model.standing(saved).confirmedByMe).toBe(true);
    expect(model.errorText).toBeNull();
    // Marked for the list to bring into view, so a row added below the fold is still seen.
    expect(model.justAdded).toBe(saved.id);
  });

  test("one that couldn't be shared isn't marked to be brought into view", async () => {
    const services = await createServices({ kv: new MemoryKV(), secrets: noSecrets, env: {}, alerts: null });
    services.deadlines.submit = () => Promise.reject(new Error('offline'));
    const model = new DeadlinesModel(services);
    await model.load(['CA116']);
    await model.add({ title: 'Lab 2', kind: 'labReport', due: inDays(5), gradeWeight: 0 }, { moduleKey: 'CA116', atGroupKey: null, label: '' });
    expect(model.justAdded).toBeNull();
    // Still said once the reload after it has worked, rather than wiped by it.
    expect(model.errorText).toBe("Couldn't share that deadline.");
    expect(model.sections).toEqual([]);
  });

  test("shared, but a name that didn't save is still said after the reload", async () => {
    const services = await createServices({ kv: new MemoryKV(), secrets: noSecrets, env: {}, alerts: null });
    services.deadlines.setLabel = () => Promise.reject(new Error('label refused'));
    const model = new DeadlinesModel(services);
    await model.load(['CA116']);
    await model.add({ title: 'Lab 2', kind: 'labReport', due: inDays(5), gradeWeight: 0 }, { moduleKey: 'CA116', atGroupKey: null, label: 'Sorting lab' });
    expect(model.sections.flatMap((s) => s.deadlines).map((d) => d.title)).toEqual(['Lab 2']);
    expect(model.errorText).toBe("Shared, but your name for it or the details didn't save.");
  });

  test('details written on the form go up with the new deadline', async () => {
    const services = await createServices({ kv: new MemoryKV(), secrets: noSecrets, env: {}, alerts: null });
    const model = new DeadlinesModel(services);
    await model.load(['CA116']);
    const adding = model.add(
      { title: 'Lab 2', kind: 'labReport', due: inDays(5), gradeWeight: 0 },
      { moduleKey: 'CA116', atGroupKey: null, label: '' },
      '  Upload the PDF to Loop  ',
    );
    expect(model.sections.flatMap((s) => s.deadlines)[0].details).toBe('Upload the PDF to Loop');
    await adding;
    expect(model.sections.flatMap((s) => s.deadlines)[0].details).toBe('Upload the PDF to Loop');
  });
});

describe('Editing a deadline', () => {
  test("saves changed details with the poster's fields, and leaves unchanged ones alone", async () => {
    const services = await createServices({ kv: new MemoryKV(), secrets: noSecrets, env: {}, alerts: null });
    const model = new DeadlinesModel(services);
    await model.load(['CA116']);
    await model.add({ title: 'Lab 2', kind: 'labReport', due: inDays(5), gradeWeight: 0 }, { moduleKey: 'CA116', atGroupKey: null, label: '' });
    const [added] = model.sections.flatMap((s) => s.deadlines);
    const setDetails = jest.spyOn(services.deadlines, 'setDetails');

    await model.edit(added, { title: 'Lab 2', kind: 'labReport', due: added.due, gradeWeight: 0 }, '');
    expect(setDetails).not.toHaveBeenCalled();

    await model.edit(added, { title: 'Lab two', kind: 'labReport', due: added.due, gradeWeight: 5 }, 'In pairs');
    expect(setDetails).toHaveBeenCalledWith(added.id, 'In pairs');
    expect(model.sections.flatMap((s) => s.deadlines)[0]).toMatchObject({ title: 'Lab two', gradeWeight: 5, details: 'In pairs' });
  });

  test('details over the limit are not sent', async () => {
    const services = await createServices({ kv: new MemoryKV(), secrets: noSecrets, env: {}, alerts: null });
    const model = new DeadlinesModel(services);
    await model.load(['CA116']);
    await model.add({ title: 'Lab 2', kind: 'labReport', due: inDays(5), gradeWeight: 0 }, { moduleKey: 'CA116', atGroupKey: null, label: '' });
    const [added] = model.sections.flatMap((s) => s.deadlines);
    const edit = jest.spyOn(services.deadlines, 'edit');
    await model.edit(added, { title: 'Lab 2', kind: 'labReport', due: added.due, gradeWeight: 0 }, 'x'.repeat(DETAILS_LIMIT + 1));
    expect(edit).not.toHaveBeenCalled();
  });
});

describe('A moderator on the Deadlines tab', () => {
  async function asRole(role: 'student' | 'trusted' | 'admin') {
    const services = await createServices({ kv: new MemoryKV(), secrets: noSecrets, env: {}, alerts: null });
    services.role.save(role);
    const model = new DeadlinesModel(services);
    await model.load(['CA116']);
    return { services, model };
  }

  test('a trusted person confirms and an admin also edits anyone\'s; a student does neither', () => {
    expect(moderationFor('student')).toEqual({ canVerify: false, canEditAny: false });
    expect(moderationFor('trusted')).toEqual({ canVerify: true, canEditAny: false });
    expect(moderationFor('admin')).toEqual({ canVerify: true, canEditAny: true });
    expect(canEdit(moderationFor('trusted'), false)).toBe(false);
    expect(canEdit(moderationFor('student'), true)).toBe(true);
  });

  test("Confirm marks it confirmed by a moderator, and pressing it again takes that back", async () => {
    const { services, model } = await asRole('trusted');
    await services.deadlines.submit(makeDeadline({ moduleKey: 'CA116', title: 'Lab', due: inDays(3), submitterID: 'someone' }));
    await model.reload();
    await model.toggleVerified(model.sections[0].deadlines[0]);
    expect(model.sections[0].deadlines[0].status).toBe('verified');
    await model.toggleVerified(model.sections[0].deadlines[0]);
    expect(model.sections[0].deadlines[0].status).toBe('pending');
  });

  test("a moderator's edit confirms the deadline; a student's doesn't", async () => {
    for (const [role, status] of [['trusted', 'verified'], ['student', 'pending']] as const) {
      const { model } = await asRole(role);
      await model.add({ title: 'Lab', kind: 'labReport', due: inDays(3), gradeWeight: 0 }, { moduleKey: 'CA116', atGroupKey: null, label: '' });
      const [added] = model.sections.flatMap((s) => s.deadlines);
      await model.edit(added, { title: 'Lab 1', kind: 'labReport', due: added.due, gradeWeight: 0 });
      expect(model.sections.flatMap((s) => s.deadlines)[0]).toMatchObject({ title: 'Lab 1', status });
    }
  });

  test("a student's Confirm does nothing", async () => {
    const { services, model } = await asRole('student');
    await services.deadlines.submit(makeDeadline({ moduleKey: 'CA116', title: 'Lab', due: inDays(3), submitterID: 'someone' }));
    await model.reload();
    const verify = jest.spyOn(services.deadlines, 'verify');
    await model.toggleVerified(model.sections[0].deadlines[0]);
    expect(verify).not.toHaveBeenCalled();
  });
});
