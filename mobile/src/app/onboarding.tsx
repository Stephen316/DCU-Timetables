import { useCallback } from 'react';
import { TimetableCategory } from '../core/timetableEvent';
import { PrefKey } from '../data/storage';
import { ProgrammePicker } from '../features/onboarding/ProgrammePicker';
import { SignIn } from '../features/onboarding/SignIn';
import { StudentID } from '../features/onboarding/StudentID';
import { useServices } from '../state/hooks';
import { useRoot } from '../state/root';

/** Everything before the timetable: sign in, the student number, and which programme. */
export default function OnboardingRoute() {
  const { prefs } = useServices();
  const { flow, signedIn, signOut } = useRoot();
  const onSaved = useCallback((number: string) => prefs.set(PrefKey.studentID, number), [prefs]);
  const onSelect = useCallback((category: TimetableCategory) => prefs.setJSON(PrefKey.selectedProgramme, category), [prefs]);

  switch (flow) {
    case 'signIn':
      return <SignIn onSignedIn={signedIn} />;
    case 'studentID':
      return <StudentID onSaved={onSaved} onSignOut={signOut} />;
    case 'programmePicker':
      return <ProgrammePicker onSelect={onSelect} />;
    case 'shell':
      return null;
  }
}
