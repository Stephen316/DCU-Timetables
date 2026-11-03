import { DeadlineDraft, DeadlineRules, LABEL_LIMIT, makeDeadline, TITLE_LIMIT } from '../src/core/deadline';
import { groupKeyOf } from '../src/core/timetableEvent';
import { createServices } from '../src/data/services';
import { MemoryKV } from '../src/data/storage';
import { DeadlinesModel } from '../src/features/deadlines/DeadlinesModel';
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
  });
});
