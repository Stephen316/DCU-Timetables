import { useState } from 'react';
import { Linking, Pressable, StyleSheet, TextInput, TextInputProps, View } from 'react-native';
import { DCUEmail, parseDCUEmail, PasswordValidation } from '../../core/identity';
import { AuthError, AuthService } from '../../data/auth';
import { errorMessage } from '../../data/rest';
import { AuthenticatedUser } from '../../data/session';
import { useServices } from '../../state/hooks';
import { AppLinks } from '../../ui/links';
import { ActionRow, Icon, ListScroll, PrimaryButton, Row, Section, Segmented, Txt } from '../../ui/components';
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
  /** One switch for both fields, so the two can be compared by eye. */
  const [revealed, setRevealed] = useState(false);
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
      if (error instanceof AuthError && error.kind === 'emailNotConfirmed') {
        await notConfirmed();
        return;
      }
      // Emptied so the retry is typed fresh. Left filled, iOS wipes a secure field on the
      // first keystroke after it regains focus, and the text React holds can disagree with
      // what the field shows — so a correct second try could send something else.
      if (error instanceof AuthError && error.kind === 'invalidCredentials') setPassword('');
      throw error;
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
        else if (outcome.kind === 'alreadyRegistered') {
          // Back to Sign in with the address kept, so signing in or resetting is one tap.
          setMode('signIn');
          setPassword('');
          setConfirmPassword('');
          setNote('An account with this email already exists. Sign in, or tap "Forgot password?" to reset it.');
        } else onSignedIn(outcome.user);
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
              <PasswordField
                value={password}
                onChangeText={setPassword}
                placeholder="Password"
                autoComplete="password"
                revealed={revealed}
                onToggleReveal={() => setRevealed((shown) => !shown)}
                returnKeyType={mode === 'signIn' ? 'go' : 'next'}
                onSubmitEditing={() => mode === 'signIn' && canSubmit && submit()}
              />
            </Row>
            {mode === 'createAccount' ? (
              <Row>
                <PasswordField
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Confirm password"
                  revealed={revealed}
                  onToggleReveal={() => setRevealed((shown) => !shown)}
                  returnKeyType="go"
                  onSubmitEditing={() => canSubmit && submit()}
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

/**
 * A password input with a button to show what's been typed. The eye shows the state it
 * switches to, as iOS's own password fields do.
 */
function PasswordField({
  placeholder, revealed, onToggleReveal, ...input
}: Pick<TextInputProps, 'value' | 'onChangeText' | 'autoComplete' | 'returnKeyType' | 'onSubmitEditing'> & {
  placeholder: string;
  revealed: boolean;
  onToggleReveal: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.passwordLine}>
      <TextInput
        {...input}
        placeholder={placeholder}
        placeholderTextColor={theme.inkTertiary}
        secureTextEntry={!revealed}
        textContentType="password"
        // Shown in plain text, the keyboard would otherwise capitalise and correct it.
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        style={[styles.input, styles.passwordInput, { color: theme.ink }]}
        accessibilityLabel={placeholder}
      />
      <Pressable
        onPress={onToggleReveal}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
        style={styles.reveal}
      >
        <Icon name={revealed ? 'hide' : 'show'} size={22} color={theme.inkSecondary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { marginHorizontal: Space.xs },
  input: { fontSize: 17, minHeight: 36 },
  passwordLine: { flexDirection: 'row', alignItems: 'center' },
  passwordInput: { flex: 1 },
  reveal: { minWidth: 44, minHeight: 36, alignItems: 'flex-end', justifyContent: 'center' },
  bottom: { height: Space.xl },
});
