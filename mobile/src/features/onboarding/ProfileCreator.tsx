import { useEffect, useState } from 'react';
import { cohortForCourseKey, profileFromAllocation, StudentProfile } from '../../core/profile';
import { AllocationStore, RosterSummary } from '../../data/courseData';
import { AuthenticatedUser, userEmail } from '../../data/session';
import { useServices } from '../../state/hooks';
import { ActionRow, ListScroll, Row, Section, Spinner, Txt } from '../../ui/components';
import { useTheme } from '../../ui/theme';
import { ScreenTitle } from './ScreenTitle';

type Status =
  | { kind: 'loading' }
  | { kind: 'chooseCourse'; rosters: RosterSummary[] }
  | { kind: 'resolving' }
  | { kind: 'pickSubgroup'; course: string; options: string[] }
  | { kind: 'noList' }
  | { kind: 'notFound' }
  | { kind: 'conflict' }
  | { kind: 'failed'; message: string };

const OFFLINE = "Couldn't reach the server to look up your group. Check your connection.";

/**
 * The class lists this app can build a timetable for. A list for any other course has no
 * timetable here to put the student's labs into, so it isn't offered.
 */
async function usableLists(store: AllocationStore): Promise<Status> {
  try {
    const usable = (await store.rosters()).filter((r) => cohortForCourseKey(r.courseKey) !== null);
    return usable.length === 0 ? { kind: 'noList' } : { kind: 'chooseCourse', rosters: usable };
  } catch {
    return { kind: 'failed', message: OFFLINE };
  }
}

/**
 * After sign-in the student's name comes from their verified address, so there is nothing
 * to type. They pick their course, the server matches the address against that course's
 * class list (`resolve_allocation`), and the profile is made from the result. The phone
 * never sees the class list.
 */
export function ProfileCreator({
  user, onCreate, onChooseProgramme, onSignOut,
}: { user: AuthenticatedUser; onCreate: (profile: StudentProfile) => void; onChooseProgramme: () => void; onSignOut: () => void }) {
  const theme = useTheme();
  const { allocations: store } = useServices();
  const [status, setStatus] = useState<Status>(store ? { kind: 'loading' } : { kind: 'noList' });
  const email = userEmail(user);

  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    void usableLists(store).then((next) => !cancelled && setStatus(next));
    return () => {
      cancelled = true;
    };
  }, [store]);

  const retry = () => {
    if (!store) return;
    setStatus({ kind: 'loading' });
    void usableLists(store).then(setStatus);
  };

  const resolve = async (courseKey: string, subgroup: string | null) => {
    const cohort = cohortForCourseKey(courseKey);
    if (!store || !cohort) return;
    setStatus({ kind: 'resolving' });
    try {
      const resolution = await store.resolve(courseKey, subgroup);
      switch (resolution.kind) {
        case 'matched': {
          const allocation = await store.allocation(courseKey, resolution.key);
          if (!allocation) return setStatus({ kind: 'notFound' });
          onCreate(profileFromAllocation(email?.displayName ?? '', cohort, allocation, resolution.key, resolution.version));
          return;
        }
        case 'ambiguous':
          // Asked once. A second ambiguous answer means the subgroup didn't separate them either.
          if (subgroup === null) {
            setStatus({ kind: 'pickSubgroup', course: courseKey, options: await store.subgroups(courseKey) });
          } else {
            setStatus({ kind: 'notFound' });
          }
          return;
        case 'notListed': return setStatus({ kind: 'notFound' });
        case 'conflict': return setStatus({ kind: 'conflict' });
        case 'noRoster': return setStatus({ kind: 'noList' });
      }
    } catch {
      setStatus({ kind: 'failed', message: OFFLINE });
    }
  };

  const explain = (text: string) => (
    <Section>
      <Row><Txt color={theme.inkSecondary}>{text}</Txt></Row>
    </Section>
  );

  return (
    <ListScroll>
      <ScreenTitle title="Your timetable" />
      {email ? (
        <Section bare>
          <Txt type="subheadline" color={theme.inkSecondary}>Signed in as {email.displayName}, {email.address}</Txt>
        </Section>
      ) : null}

      {status.kind === 'loading' || status.kind === 'resolving' ? (
        <Section>
          <Row><Spinner label={status.kind === 'loading' ? 'Checking class lists…' : 'Finding your group…'} /></Row>
        </Section>
      ) : null}
      {status.kind === 'chooseCourse' ? (
        <Section header="Which course are you in?">
          {status.rosters.map((r) => (
            <ActionRow key={r.courseKey} title={r.title ?? r.courseKey} onPress={() => void resolve(r.courseKey, null)} />
          ))}
        </Section>
      ) : null}
      {status.kind === 'pickSubgroup' ? (
        <Section>
          <Row><Txt color={theme.inkSecondary}>More than one student on the class list has your name. Which subgroup are you in?</Txt></Row>
          {status.options.map((option) => (
            <ActionRow key={option} title={option} onPress={() => void resolve(status.course, option)} />
          ))}
        </Section>
      ) : null}
      {status.kind === 'noList' ? explain("No class list has been uploaded for your course yet, so your lab group can't be looked up. You can still pick your programme.") : null}
      {status.kind === 'notFound' ? explain("Your name isn't on the class list, so we can't tell which lab group you're in. You can still pick your programme.") : null}
      {status.kind === 'conflict' ? explain("Your details don't match the class list cleanly, so it's been sent for a person to check. Pick your programme for now.") : null}
      {status.kind === 'failed' ? (
        <Section>
          <Row><Txt color={theme.inkSecondary}>{status.message}</Txt></Row>
          <ActionRow title="Try again" onPress={retry} />
        </Section>
      ) : null}

      {status.kind !== 'loading' && status.kind !== 'resolving' ? (
        <Section>
          <ActionRow title="Choose a programme instead" icon="search" onPress={onChooseProgramme} />
          <ActionRow title="Sign out" icon="signOut" destructive onPress={onSignOut} />
        </Section>
      ) : null}
    </ListScroll>
  );
}
