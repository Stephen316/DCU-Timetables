import { makeDeadline } from '../src/core/deadline';
import { createServices } from '../src/data/services';
import { MemoryKV } from '../src/data/storage';
import { DeadlinesModel } from '../src/features/deadlines/DeadlinesModel';

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
