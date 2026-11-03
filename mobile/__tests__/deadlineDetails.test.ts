import { DETAILS_LIMIT, detailsEditedLabel, DeadlineRules, makeDeadline } from '../src/core/deadline';
import { createServices } from '../src/data/services';
import { MemoryKV } from '../src/data/storage';
import { DeadlinesModel } from '../src/features/deadlines/DeadlinesModel';
import { at } from './helpers';

const noSecrets = { get: async () => null, set: async () => {}, remove: async () => {} };
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000);

describe('Deadline details', () => {
  test('say roughly when they last changed', () => {
    const now = at(2026, 11, 3, 15);
    expect(detailsEditedLabel(at(2026, 11, 3, 14, 59), now)).toBe('Edited 1 min ago');
    expect(detailsEditedLabel(new Date(now.getTime() - 20_000), now)).toBe('Edited just now');
    expect(detailsEditedLabel(at(2026, 11, 3, 13), now)).toBe('Edited 2h ago');
    expect(detailsEditedLabel(at(2026, 11, 2, 9), now)).toBe('Edited yesterday');
    expect(detailsEditedLabel(at(2026, 10, 30, 9), now)).toBe('Edited 4 days ago');
    expect(detailsEditedLabel(at(2026, 10, 1, 9), now)).toBe('Edited 1 October');
  });

  test("are held to the server's limit, and blank is allowed: it clears them", () => {
    expect(DeadlineRules.detailsProblem('x'.repeat(DETAILS_LIMIT))).toBeNull();
    expect(DeadlineRules.detailsProblem('x'.repeat(DETAILS_LIMIT + 1))).not.toBeNull();
    expect(DeadlineRules.detailsProblem('   ')).toBeNull();
  });

  async function loaded(submitterID = 'someone else') {
    const services = await createServices({ kv: new MemoryKV(), secrets: noSecrets, env: {}, alerts: null });
    await services.deadlines.submit(makeDeadline({ moduleKey: 'CA116', title: 'Lab 2', due: inDays(3), submitterID }));
    const model = new DeadlinesModel(services);
    await model.load(['CA116']);
    const shown = () => model.sections.flatMap((s) => s.deadlines)[0];
    return { services, model, shown };
  }

  test("anyone can write them, on someone else's deadline, and they show before the save returns", async () => {
    const { services, model, shown } = await loaded();
    expect(model.isMine(shown())).toBe(false);
    const saving = model.details.save(shown(), '  Upload the zip to Loop  ');
    expect(shown().details).toBe('Upload the zip to Loop');
    expect(shown().detailsEditedAt).toBeInstanceOf(Date);
    await saving;
    expect((await services.deadlines.deadlinesForModule('CA116'))[0].details).toBe('Upload the zip to Loop');
    expect(model.details.problem(shown())).toBeNull();
  });

  test('a refused save puts the old text back, with the reason under it', async () => {
    const { services, model, shown } = await loaded();
    jest.spyOn(services.deadlines, 'setDetails').mockRejectedValueOnce(new Error('this deadline was blocked'));
    const before = shown();
    await model.details.save(before, 'Spoiled');
    expect(shown().details).toBe('');
    expect(model.details.problem(shown())).toBe("Couldn't save the details.");
  });

  test('saving what is already there sends nothing', async () => {
    const { services, model, shown } = await loaded();
    const set = jest.spyOn(services.deadlines, 'setDetails');
    await model.details.save(shown(), '   ');
    expect(set).not.toHaveBeenCalled();
  });

  test('can be reported by anyone, the poster too, without hiding the deadline', async () => {
    const { services, model, shown } = await loaded('me');
    const report = jest.spyOn(services.deadlines, 'report');
    await model.details.report(shown());
    expect(report).toHaveBeenCalledWith(shown().id, 'details');
    expect(model.details.reported.has(shown().id)).toBe(true);
    expect(model.sections.flatMap((s) => s.deadlines)).toHaveLength(1);
  });
});
