import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { PasswordValidation } from '../../core/identity';
import { AuthError } from '../../data/auth';
import { errorMessage } from '../../data/rest';
import { useServices } from '../../state/hooks';
import { ActionRow, ListScroll, PrimaryButton, Row, Section, Txt } from '../../ui/components';
import { Space, useTheme } from '../../ui/theme';
import { PasswordField } from './PasswordField';
import { ScreenTitle } from './ScreenTitle';

/**
 * Where a password-reset email lands. The link has already signed the student in — that is
 * what Supabase's recovery session is for — so this screen only has to set the new
 * password; there is nothing to prove and no old password to ask for.
 */
export function NewPassword({ address, onDone }: { address: string; onDone: () => void }) {
  const theme = useTheme();
  const { auth } = useServices();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const problem = PasswordValidation.problem(password, confirmPassword);
  const canSave = PasswordValidation.canCreateAccount(password, confirmPassword) && !busy;

  const save = () => {
    if (!auth) {
      setNote(AuthError.notConfigured().message);
      return;
    }
    setBusy(true);
    setNote(null);
    auth
      .setPassword(password)
      .then(onDone)
      .catch((error) => {
        // Kept on the screen rather than thrown back to sign-in: the recovery session is
        // still good, so a second attempt costs nothing but another try.
        setPassword('');
        setConfirmPassword('');
        setNote(errorMessage(error, "Couldn't change your password. Try again."));
      })
      .finally(() => setBusy(false));
  };

  return (
    <ListScroll>
      <ScreenTitle title="Set a new password" />
      <Section bare>
        <Txt type="subheadline" color={theme.inkSecondary} style={styles.intro}>
          {`Choose a new password for ${address}. You'll stay signed in on this device.`}
        </Txt>
      </Section>

      <Section>
        <Row>
          <PasswordField
            value={password}
            onChangeText={setPassword}
            placeholder="New password"
            revealed={revealed}
            onToggleReveal={() => setRevealed((shown) => !shown)}
            returnKeyType="next"
          />
        </Row>
        <Row>
          <PasswordField
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="Confirm new password"
            revealed={revealed}
            onToggleReveal={() => setRevealed((shown) => !shown)}
            returnKeyType="go"
            onSubmitEditing={() => canSave && save()}
          />
          <Txt type="caption" color={theme.inkSecondary}>
            {problem ? PasswordValidation.message(problem) : PasswordValidation.requirements}
          </Txt>
        </Row>
      </Section>

      {note ? (
        <Section>
          <Row><Txt type="callout" color={theme.inkSecondary}>{note}</Txt></Row>
        </Section>
      ) : null}

      <Section bare>
        <PrimaryButton title="Save password" busy={busy} disabled={!canSave} onPress={save} />
      </Section>
      <Section>
        {/* The link signed them in, so leaving it unchanged is a real choice, not a dead end. */}
        <ActionRow title="Keep my old password" disabled={busy} onPress={onDone} />
      </Section>
      <View style={styles.bottom} />
    </ListScroll>
  );
}

const styles = StyleSheet.create({
  intro: { marginHorizontal: Space.xs },
  bottom: { height: Space.xl },
});
