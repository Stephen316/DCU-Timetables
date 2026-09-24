import { useCallback } from 'react';
import { PrefKey } from '../data/storage';
import { ProfileCreator } from '../features/onboarding/ProfileCreator';
import { ProgrammePicker } from '../features/onboarding/ProgrammePicker';
import { SignIn } from '../features/onboarding/SignIn';
import { StudentID } from '../features/onboarding/StudentID';
import { useServices } from '../state/hooks';
import { useRoot } from '../state/root';

/** Everything before the timetable: sign in, the student number, and which timetable. */
export default function OnboardingRoute() {
  const { prefs } = useServices();
  const { flow, user, signedIn, signOut } = useRoot();
  const onSaved = useCallback((number: string) => prefs.set(PrefKey.studentID, number), [prefs]);

  switch (flow) {
    case 'signIn':
      return <SignIn onSignedIn={signedIn} />;
    case 'studentID':
      return <StudentID onSaved={onSaved} onSignOut={signOut} />;
    case 'programmePicker':
      return (
        <ProgrammePicker
          onSelect={(category) => {
            prefs.setJSON(PrefKey.selectedProgramme, category);
            prefs.set(PrefKey.hiddenGroups, null);
            prefs.set(PrefKey.useProgrammePicker, null);
          }}
        />
      );
    case 'profileCreator':
      return user ? (
        <ProfileCreator
          user={user}
          onCreate={(profile) => {
            prefs.setJSON(PrefKey.profile, profile);
            prefs.set(PrefKey.hiddenGroups, null);
          }}
          onChooseProgramme={() => prefs.setBool(PrefKey.useProgrammePicker, true)}
          onSignOut={signOut}
        />
      ) : null;
    case 'shell':
      return null;
  }
}
