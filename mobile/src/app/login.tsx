import { useCallback } from 'react';
import { TimetableCategory } from '../core/timetableEvent';
import { PrefKey } from '../data/storage';
import { NewPassword } from '../features/onboarding/NewPassword';
import { ProgrammePicker } from '../features/onboarding/ProgrammePicker';
import { SignIn } from '../features/onboarding/SignIn';
import { AccountSetup } from '../features/onboarding/AccountSetup';
import { useServices } from '../state/hooks';
import { useRoot } from '../state/root';

/**
 * Everything before the timetable: sign in, the new password a reset link asks for, the
 * student number, and which programme.
 */
export default function LoginRoute() {
  const { prefs } = useServices();
  const { flow, user, notice, signedIn, signOut, passwordResetDone } = useRoot();
  const onSaved = useCallback((number: string) => prefs.set(PrefKey.studentID, number), [prefs]);
  const onSelect = useCallback((category: TimetableCategory) => prefs.setJSON(PrefKey.selectedProgramme, category), [prefs]);

  switch (flow) {
    case 'signIn':
      return <SignIn onSignedIn={signedIn} notice={notice} />;
    case 'newPassword':
      return <NewPassword address={user?.address ?? ''} onDone={passwordResetDone} />;
    case 'studentID':
      return <AccountSetup key={user?.id} onSaved={onSaved} onSignOut={signOut} />;
    case 'programmePicker':
      return <ProgrammePicker onSelect={onSelect} onSignOut={signOut} />;
    case 'shell':
      return null;
  }
}
