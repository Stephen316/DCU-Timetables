import {
  allocationFromRow, decodeProfile, makeChange, makeProfile, profileFromAllocation, TimetableAudience, TimetableChanges,
} from '../src/core/profile';
import { DublinTime } from '../src/core/time';

// A class test sitting is a grouping on the class list like a project team, stored under its
// own key so it never replaces the team (supabase/phase60).
describe('a change for one member of a grouping', () => {
  const sitting = (id: string) => makeChange({
    id: `s-${id}`, courseKey: 'EEG1', group: `SITTING_GROUP:${id}`, kind: 'add', module: 'EEG1007',
    title: 'Class Test', dates: ['2026-11-18'], start: '13:00', end: '14:00', room: 'S143',
  });
  const presentation = makeChange({
    id: 't-A1.A', courseKey: 'EEG1', group: 'TEAM:A1.A', kind: 'add', module: 'EEG1001',
    title: 'Preliminary Design Presentation', dates: ['2026-11-18'], start: '15:00', end: '15:15', room: 'S378',
  });
  const week = DublinTime.date('2026-11-16', '00:00');
  const student = (groupings: Record<string, string>, team: string | null = 'A1.a') =>
    new TimetableAudience('EEG1', 'D', 'D.4', null, team, groupings);

  test('reaches the sitting it names, whatever the capitalisation, and shows its room and time', () => {
    const out = TimetableChanges.apply([], [sitting('S143-18NOV-1300')], student({ sitting_group: 's143-18nov-1300' }), week);
    expect(out).toHaveLength(1);
    expect(out[0].locations).toEqual(['S143']);
    expect(DublinTime.timeString(out[0].start)).toBe('13:00');
  });

  test('does not reach another sitting, or a student with no sitting', () => {
    expect(TimetableChanges.apply([], [sitting('S143-18NOV-1300')], student({ sitting_group: 'S144-18NOV-1300' }), week)).toEqual([]);
    expect(TimetableChanges.apply([], [sitting('S143-18NOV-1300')], student({}), week)).toEqual([]);
  });

  test('a sitting and a team are told apart by their key', () => {
    // The same ID under another key is someone else.
    expect(TimetableChanges.apply([], [sitting('A1.A')], student({}, 'A1.a'), week)).toEqual([]);
    // A student keeps their team's slot beside their sitting.
    expect(TimetableChanges.apply([], [sitting('S143-18NOV-1300'), presentation],
      student({ sitting_group: 'S143-18NOV-1300' }), week)).toHaveLength(2);
  });

  test('the class list row carries its groupings, apart from the team, through to the audience', () => {
    const allocation = allocationFromRow({ grp: 'D', subgroup: 'D.4', extra: { team: 'A1.a', sitting_group: 'S143-18NOV-1300' } });
    expect(allocation?.team).toBe('A1.a');
    expect(allocation?.groupings).toEqual({ sitting_group: 'S143-18NOV-1300' });
    expect(allocationFromRow({ grp: 'D', extra: { team: 'A1.a' } })?.groupings).toBeUndefined();

    const profile = profileFromAllocation('S', 'engineeringYear1', allocation!, 'k', 3);
    const saved = decodeProfile(JSON.parse(JSON.stringify(profile)));
    expect(saved?.groupings).toEqual({ sitting_group: 'S143-18NOV-1300' });
    expect(TimetableChanges.apply([], [sitting('S143-18NOV-1300')], TimetableAudience.forProfile(saved!), week)).toHaveLength(1);
  });

  test('a saved profile with nonsense groupings keeps none of them', () => {
    expect(decodeProfile({ name: 'S', group: 'D', groupings: { 'Bad Key': 'x', sitting_group: 3 } })?.groupings).toBeUndefined();
    expect(makeProfile({ name: 'S', group: 'D' }).groupings).toBeUndefined();
  });
});
