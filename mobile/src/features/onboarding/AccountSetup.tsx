import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, View } from 'react-native';
import { StudentNumber } from '../../core/identity';
import { errorMessage, isNotSignedIn } from '../../data/rest';
import { useServices } from '../../state/hooks';
import { Txt } from '../../ui/components';
import { Space, useTheme } from '../../ui/theme';
import Stepper, { Step } from './Stepper';
import { StudentID } from './StudentID';
import { SetupSurface } from './SetupSurface';
import { SetupButton } from './SetupButton';
import { SetupPlan, StudentNumberField } from './SetupFields';

const PLUS_PROMO = 'https://info.dcutimetables.app/purchase/';

export function AccountSetup({ onSaved, onSignOut }: { onSaved: (number: string) => void; onSignOut: () => void }) {
  const { auth, plus, profiles } = useServices();
  const theme = useTheme();
  const [step, setStep] = useState(1);
  const [checking, setChecking] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [plan, setPlan] = useState<'checking' | 'standard' | 'plus' | 'unavailable'>('checking');
  const hasPlus = plan === 'plus';
  const [camera, setCamera] = useState(false);
  const [manual, setManual] = useState(false);
  const [entry, setEntry] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState(false);
  const busy = useRef(false);
  const number = StudentNumber.fromTyped(entry);

  useEffect(() => {
    let cancelled = false;
    void profiles.myProfile().then((profile) => {
      if (cancelled) return;
      if (profile?.studentID) onSaved(profile.studentID);
      else setChecking(false);
    }).catch((error) => {
      if (cancelled) return;
      if (isNotSignedIn(error)) onSignOut();
      else setProfileError(errorMessage(error, "Couldn't check your account. Try again."));
    });
    return () => { cancelled = true; };
  }, [attempt, profiles, onSaved, onSignOut]);

  useEffect(() => {
    if (step !== 2) return;
    let cancelled = false;
    // Local mode has no paid account. Its permissive Plus store is for offline features.
    void (auth ? plus.status() : Promise.resolve({ active: false })).then(({ active }) => {
      if (!cancelled) setPlan(active ? 'plus' : 'standard');
    }).catch((error) => {
      if (cancelled) return;
      if (isNotSignedIn(error)) onSignOut();
      else setPlan('unavailable');
    });
    return () => { cancelled = true; };
  }, [auth, plus, step, onSignOut]);

  const saveNumber = async () => {
    if (!number || busy.current) return;
    busy.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      await profiles.setStudentID(number);
      onSaved(number);
    } catch (error) {
      if (isNotSignedIn(error)) onSignOut();
      else setSaveError(errorMessage(error, "Couldn't save your student number. Try again."));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  if (checking) {
    return (
      <SetupSurface>
        <View style={[styles.status, { backgroundColor: theme.raised }]}>
          {profileError ? (
            <>
              <Txt accessibilityLiveRegion="polite">{profileError}</Txt>
              <SetupButton variant="outline" title="Try again" onPress={() => { setProfileError(null); setAttempt(attempt + 1); }} />
              <SetupButton variant="outline" title="Sign out" onPress={onSignOut} />
            </>
          ) : <ActivityIndicator accessibilityLabel="Checking account" color={theme.inkSecondary} />}
        </View>
      </SetupSurface>
    );
  }

  if (camera) {
    return (
      <StudentID
        onRead={(scanned) => { setEntry(scanned); setCamera(false); setStep(4); }}
        onOtherMethods={() => { setManual(true); setCamera(false); }}
      />
    );
  }

  return (
    <SetupSurface>
      <Stepper
        step={step}
        onStepChange={setStep}
        onFinalStepCompleted={() => void saveNumber()}
        backButtonText="Back"
        nextButtonText={step === 4 ? 'Complete' : step === 2 && hasPlus ? 'Continue with Plus' : 'Continue'}
        showNext={step !== 3 || manual}
        nextDisabled={(step === 2 && plan === 'checking') || (step === 3 && number === null)}
        busy={saving}
      >
        <Step title="Welcome">
          <Txt type="title3" accessibilityRole="header">Welcome to DCU Timetable</Txt>
          <Txt color={theme.inkSecondary}>Set up your account in a few quick steps.</Txt>
        </Step>
        <Step title="Plan">
          <Txt type="title3" accessibilityRole="header">Choose a plan</Txt>
          <SetupPlan title="Standard" description="Free · Your timetable and class updates" selected={plan === 'standard'} />
          <SetupPlan title="Plus" description="Full deadlines list and class alerts" selected={hasPlus} onExplore={!hasPlus && plan !== 'checking' ? () => {
            setLinkError(false);
            void Linking.openURL(PLUS_PROMO).catch(() => setLinkError(true));
          } : undefined} />
          {plan === 'checking' ? <Txt type="footnote" accessibilityLiveRegion="polite">Checking your plan…</Txt> : null}
          {plan === 'unavailable' ? <Txt type="footnote" accessibilityLiveRegion="polite">Couldn’t check your plan. You can still continue setup.</Txt> : null}
          {linkError ? <Txt accessibilityLiveRegion="polite">Couldn’t open the Plus page. Try again.</Txt> : null}
        </Step>
        <Step title="Profile">
          {manual ? (
            <>
              <Txt type="title3" accessibilityRole="header">Enter your student number</Txt>
              <StudentNumberField
                value={entry}
                disabled={saving}
                onChange={(value) => { setEntry(value); setSaveError(null); }}
                onSubmit={() => { if (number) setStep(4); }}
              />
              <Txt type="footnote" color={theme.inkSecondary}>Enter the letter and eight digits from your student ID. Once saved, only an admin can change it.</Txt>
              <SetupButton variant="outline" title="Use camera" disabled={saving} onPress={() => setCamera(true)} />
            </>
          ) : (
            <View style={styles.cameraStep}>
              <Txt type="title3" accessibilityRole="header" style={styles.cameraTitle}>Take a photo of your student ID</Txt>
              <View style={styles.cameraActions}>
                <SetupButton title="Open camera" icon={<Ionicons name="camera-outline" size={18} color={theme.onAccent} />} onPress={() => setCamera(true)} />
                <SetupButton variant="outline" title="Other methods" onPress={() => setManual(true)} />
              </View>
            </View>
          )}
        </Step>
        <Step title="Review">
          <Txt type="title3" accessibilityRole="header">Looking good</Txt>
          <Txt color={theme.inkSecondary}>{hasPlus ? 'Plus plan' : plan === 'standard' ? 'Standard plan' : 'Plan unavailable'}</Txt>
          <Txt color={theme.inkSecondary}>Student number {number}. Complete setup to choose your programme.</Txt>
          {saveError ? <Txt accessibilityLiveRegion="polite">{saveError}</Txt> : null}
        </Step>
      </Stepper>
      <View style={styles.signOut}>
        <SetupButton variant="ghost" title="Sign out" disabled={saving} onPress={onSignOut} />
      </View>
    </SetupSurface>
  );
}

const styles = StyleSheet.create({
  cameraStep: { alignItems: 'center', gap: Space.l, paddingVertical: Space.s },
  cameraTitle: { textAlign: 'center', fontSize: 17, lineHeight: 22 },
  cameraActions: { width: '100%', maxWidth: 240, gap: Space.s },
  signOut: { alignSelf: 'center', justifyContent: 'center', minHeight: 44, paddingHorizontal: Space.l },
  status: { alignSelf: 'center', width: '100%', maxWidth: 440, gap: Space.m, padding: Space.l, borderRadius: 12 },
});
