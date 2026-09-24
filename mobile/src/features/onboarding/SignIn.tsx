import { useState } from 'react';
import { Linking, StyleSheet, TextInput, View } from 'react-native';
import { DCUEmail, parseDCUEmail, PasswordValidation } from '../../core/identity';
import { AuthError, AuthService } from '../../data/auth';
import { errorMessage } from '../../data/rest';
import { AuthenticatedUser } from '../../data/session';
import { useServices } from '../../state/hooks';
import { AppLinks } from '../../ui/links';
import { ActionRow, ListScroll, PrimaryButton, Row, Section, Segmented, Txt } from '../../ui/components';
import { Space, useTheme } from '../../ui/theme';
import { ScreenTitle } from './ScreenTitle';

type Mode = 'signIn' | 'createAccount';

/**
 * DCU-only sign-in with an email address and password. Creating an account sends
 * Supabase's confirmation email; the account can't be used until the link in it is tapped,
 * which is what proves the address is theirs. The name then comes from the address.
 */
export function SignIn({ onSignedIn }: { onSignedIn: (user: AuthenticatedUser) => void }) {
  const theme = useTheme();
  const { auth } = useServices();
  const [mode, setMode] = useState<Mode>('signIn');
  const [address, setAddress] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /** Set once the confirmation email has been sent — the form then shows only that step. */
  const [awaiting, setAwaiting] = useState<DCUEmail | null>(null);

  const email = parseDCUEmail(address);
  const addressLooksWrong = address.length > 0 && email === null;
  const problem = PasswordValidation.problem(password, confirmPassword);
  const canSubmit =
    email !== null && password.length > 0 && !busy &&
    (mode === 'signIn' || PasswordValidation.canCreateAccount(password, confirmPassword));

  /** Shared busy/error handling so each action stays a single statement. */
  const run = (work: (auth: AuthService) => Promise<void>) => {
    if (!auth) {
      setNote(AuthError.notConfigured().message);
      return;
    }
    setBusy(true);
    setNote(null);
    work(auth)
      .catch((error) => setNote(errorMessage(error, 'Something went wrong.')))
      .finally(() => setBusy(false));
  };

  /** `password` is deliberately kept — Continue re-tries the sign-in with it. */
  const startConfirmation = (account: DCUEmail, message: string | null) => {
    setAwaiting(account);
    setConfirmPassword('');
    setMode('signIn');
    setNote(message);
  };

  const signInAs = async (service: AuthService, account: DCUEmail, notConfirmed: () => Promise<void>) => {
    try {
      onSignedIn(await service.signIn(account, password));
    } catch (error) {
      if (error instanceof AuthError && error.kind === 'emailNotConfirmed') await notConfirmed();
      else throw error;
    }
  };

  const submit = () => {
    if (!email) return;
    if (mode === 'signIn') {
      run((service) =>
        signInAs(service, email, async () => {
          // The account exists but was never confirmed — send the email again and say so,
          // rather than letting a correct password look wrong.
          await service.resendConfirmation(email).catch(() => undefined);
          startConfirmation(email, "This address hasn't been confirmed yet.");
        }),
      );
    } else {
      run(async (service) => {
        const outcome = await service.signUp(email, password);
        if (outcome.kind === 'needsEmailConfirmation') startConfirmation(email, null);
        else onSignedIn(outcome.user);
      });
    }
  };

  const noteSection = note ? (
    <Section>
      <Row><Txt type="callout" color={theme.inkSecondary}>{note}</Txt></Row>
    </Section>
  ) : null;

  return (
    <ListScroll>
      <ScreenTitle title="DCU Timetable" />
      <Section bare>
        <Txt type="subheadline" color={theme.inkSecondary} style={styles.intro}>
          {"Use your DCU email address. Your name and lab group come from it, so there's nothing else to fill in."}
        </Txt>
      </Section>

      {awaiting ? (
        <>
          {/* Confirming happens in the browser, so the app can't observe it — Continue asks again. */}
          <Section>
            <Row>
              <Txt type="headline">Check your email</Txt>
              <Txt color={theme.inkSecondary}>{`We've sent a confirmation link to ${awaiting.address}. Tap it, then come back here.`}</Txt>
            </Row>
          </Section>
          {noteSection}
          <Section bare>
            <PrimaryButton
              title="Continue"
              busy={busy}
              onPress={() =>
                run((service) =>
                  signInAs(service, awaiting, async () => {
                    setNote('Not confirmed yet — tap the link in the email, then press Continue.');
                  }),
                )
              }
            />
          </Section>
          <Section>
            <ActionRow
              title="Send the email again"
              disabled={busy}
              onPress={() => run(async (service) => {
                await service.resendConfirmation(awaiting);
                setNote(`Sent again to ${awaiting.address}.`);
              })}
            />
            <ActionRow title="Use a different email" disabled={busy} onPress={() => { setAwaiting(null); setNote(null); }} />
          </Section>
        </>
      ) : (
        <>
          <Section bare>
            <Segmented
              label="Sign in or create an account"
              value={mode}
              onChange={(next) => {
                setMode(next);
                setConfirmPassword('');
                setNote(null);
              }}
              options={[{ value: 'signIn', label: 'Sign in' }, { value: 'createAccount', label: 'Create account' }]}
            />
          </Section>

          <Section>
            <Row>
              <TextInput
                value={address}
                onChangeText={setAddress}
                placeholder="Email"
                placeholderTextColor={theme.inkTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                autoComplete="email"
                style={[styles.input, { color: theme.ink }]}
                accessibilityLabel="Email"
              />
              {addressLooksWrong ? (
                <Txt type="caption" color={theme.inkSecondary}>{address.trim()} is not a valid email address</Txt>
              ) : email ? (
                <Txt type="caption" color={theme.inkSecondary}>Signing in as {email.displayName}</Txt>
              ) : null}
            </Row>
            <Row>
              {/* "password", never "newPassword": the latter opens iOS's strong-password sheet over the fields. */}
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Password"
                placeholderTextColor={theme.inkTertiary}
                secureTextEntry
                textContentType="password"
                autoComplete="password"
                style={[styles.input, { color: theme.ink }]}
                accessibilityLabel="Password"
              />
            </Row>
            {mode === 'createAccount' ? (
              <Row>
                <TextInput
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Confirm password"
                  placeholderTextColor={theme.inkTertiary}
                  secureTextEntry
                  textContentType="password"
                  style={[styles.input, { color: theme.ink }]}
                  accessibilityLabel="Confirm password"
                />
                {/* The rules are stated before they type; the current problem takes their place. */}
                <Txt type="caption" color={theme.inkSecondary}>
                  {problem ? PasswordValidation.message(problem) : PasswordValidation.requirements}
                </Txt>
              </Row>
            ) : null}
          </Section>

          {noteSection}

          <Section
            bare
            footer={
              mode === 'createAccount' ? (
                // App Review 1.2: agreeing to terms that rule out abuse is part of letting
                // people post where classmates read it.
                <Txt type="caption" color={theme.inkSecondary}>
                  By creating an account you agree to the{' '}
                  <Txt type="caption" color={theme.accent} onPress={() => Linking.openURL(AppLinks.terms)} accessibilityRole="link">Terms of use</Txt>
                  {' '}and{' '}
                  <Txt type="caption" color={theme.accent} onPress={() => Linking.openURL(AppLinks.privacy)} accessibilityRole="link">Privacy policy</Txt>
                  {". Abusive or objectionable posts aren't tolerated: they're removed, and the account that posted them is banned."}
                </Txt>
              ) : undefined
            }
          >
            <PrimaryButton title={mode === 'signIn' ? 'Sign in' : 'Create account'} busy={busy} disabled={!canSubmit} onPress={submit} />
          </Section>

          {mode === 'signIn' ? (
            <Section>
              <ActionRow
                title="Forgot password?"
                disabled={email === null || busy}
                onPress={() => email && run(async (service) => {
                  await service.sendPasswordReset(email);
                  setNote('Password reset sent to your DCU email.');
                })}
              />
            </Section>
          ) : null}
        </>
      )}
      <View style={styles.bottom} />
    </ListScroll>
  );
}

const styles = StyleSheet.create({
  intro: { marginHorizontal: Space.xs },
  input: { fontSize: 17, minHeight: 36 },
  bottom: { height: Space.xl },
});
