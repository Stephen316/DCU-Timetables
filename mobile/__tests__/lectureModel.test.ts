import { CancellationRules } from '../src/core/cancellation';
import { createServices } from '../src/data/services';
import { MemoryKV } from '../src/data/storage';
import { LectureModel } from '../src/features/lecture/LectureModel';
import { at, event } from './helpers';

const lecture = event('EEG1001[1]OC/L1/01', at(2026, 9, 23, 9), at(2026, 9, 23, 11), { id: 'lec' });

async function setup() {
  const services = await createServices({ kv: new MemoryKV(), secrets: { get: async () => null, set: async () => {}, remove: async () => {} }, env: {}, alerts: null });
  return { services, model: new LectureModel(services, lecture) };
}

describe('Class page', () => {
  test('a report that goes through clears the failure shown for the one before', async () => {
    const { services, model } = await setup();
    const submit = services.cancellations.submit.bind(services.cancellations);
    services.cancellations.submit = async () => { throw new Error('offline'); };
    await model.report('cancelled');
    expect(model.errorText).toBe("Couldn't send that report.");

    services.cancellations.submit = submit;
    await model.report('cancelled');
    expect(model.errorText).toBeNull();
    expect(model.status.myStance).toBe('cancelled');
  });

  test("the tour ending on the page takes its practice report with it, so the real ones that follow are the student's own", async () => {
    const { services, model } = await setup();
    model.setPractice(true);
    await model.report('cancelled');
    expect(model.status.myStance).toBe('cancelled');

    // Skipped mid-way: the pretend report goes, and nothing was sent.
    model.setPractice(false);
    expect(model.status.myStance).toBeNull();

    await model.report('on');
    expect(model.status.myStance).toBe('on');
    await model.withdrawReport();
    const key = CancellationRules.eventKey(lecture);
    expect(await services.cancellations.tallies([key])).toEqual([]);
    expect(model.status.myStance).toBeNull();
  });
});
