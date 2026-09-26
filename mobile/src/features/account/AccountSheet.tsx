import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Appearance, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { AccountProfile, Roles } from '../../core/identity';
import { errorMessage } from '../../data/rest';
import { userEmail } from '../../data/session';
import { PrefKey } from '../../data/storage';
import { usePref, useServices } from '../../state/hooks';
import { AppLinks } from '../../ui/links';
import {
  ActionRow, ActionSheet, BarButton, Icon, LabeledRow, ListScroll, Row, Section, Sheet, Txt,
} from '../../ui/components';
import { appearanceLabel, AppearanceSetting, Space, useTheme } from '../../ui/theme';

const SETTINGS: AppearanceSetting[] = ['system', 'light', 'dark'];

/** Who you're signed in as, the identifier you share to be made trusted, and the way out. */
export function AccountSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  const services = useServices();
  const { profiles, deadlines, role, user: signedIn, events } = services;
  const user = signedIn.current;
  const email = user ? userEmail(user) : null;
  const [appearanceRaw, setAppearance] = usePref(PrefKey.appearance);
  const appearance = (SETTINGS as string[]).includes(appearanceRaw ?? '') ? (appearanceRaw as AppearanceSetting) : 'system';

  /** Null until counted, so a failed count shows nothing rather than a wrong "No one". */
  const [hiddenCount, setHiddenCount] = useState<number | null>(null);
  const [unhiding, setUnhiding] = useState(false);
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    deadlines.hiddenAuthorCount().then((n) => !cancelled && setHiddenCount(n), () => !cancelled && setHiddenCount(null));
    profiles.myProfile().then(
      (fetched) => {
        if (cancelled) return;
        setProfile(fetched);
        if (fetched) role.save(fetched.role);
        // Loaded, but no id to show (none allocated yet) reads the same as a failed load.
        setLoadFailed(fetched?.pi == null);
      },
      // The ID is a convenience, not worth an error dialog — it shows as "--".
      () => !cancelled && setLoadFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [visible, deadlines, profiles, role]);

  const choose = (setting: AppearanceSetting) => {
    setAppearance(setting === 'system' ? null : setting);
    if (Platform.OS !== 'web') Appearance.setColorScheme(setting === 'system' ? 'unspecified' : setting);
  };

  const copy = async (pi: string) => {
    await Clipboard.setStringAsync(pi);
    setCopied(true);
    // Long enough to read, short enough not to linger into the next thing.
    setTimeout(() => setCopied(false), 2000);
  };

  const unhideAll = async () => {
    setUnhiding(true);
    try {
      await deadlines.unhideAllAuthors();
      setHiddenCount(0);
    } catch {
      setHiddenCount(await deadlines.hiddenAuthorCount().catch(() => null));
    }
    setUnhiding(false);
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await profiles.deleteAccount();
      onClose();
      // The root owns the teardown — profile, attendance marks and voter id as well as the credentials.
      events.emit('signOutRequested');
    } catch (error) {
      setDeleteError(errorMessage(error, "Couldn't delete your account."));
    }
    setDeleting(false);
  };

  return (
    <Sheet visible={visible} title="Account" onClose={onClose} right={<BarButton title="Done" onPress={onClose} />}>
      <ListScroll>
        <Section header="Signed in as">
          <LabeledRow label="Name" value={email?.displayName ?? '--'} />
          <LabeledRow label="Email" value={user?.address ?? '--'} />
          {profile && profile.role !== 'student' ? <LabeledRow label="Role" value={Roles.label(profile.role)} /> : null}
        </Section>

        {/* Rows with a checkmark rather than a segmented control: rows wrap at large text sizes. */}
        <Section header="Appearance" footer="Match phone follows the Light or Dark setting on your phone.">
          {SETTINGS.map((setting) => (
            <Row key={setting} onPress={() => choose(setting)} accessibilityLabel={appearanceLabel(setting)}>
              <View style={styles.line}>
                <Txt>{appearanceLabel(setting)}</Txt>
                {appearance === setting ? <Icon name="check" color={theme.accent} /> : null}
              </View>
            </Row>
          ))}
        </Section>

        <Section
          header="Your ID"
          footer="Share this only with someone making you a trusted reporter. It identifies your account — it isn't a password, and it doesn't let anyone sign in as you."
        >
          {profile?.pi ? (
            <Row onPress={() => void copy(profile.pi!)} accessibilityLabel={copied ? 'Copied' : `Your ID, ${profile.pi}`} accessibilityHint="Copies it">
              <View style={styles.line}>
                <Txt type="title3" style={styles.mono} selectable>{profile.pi}</Txt>
                <Icon name={copied ? 'check' : 'copy'} color={copied ? theme.tint.confirmed : theme.accent} />
              </View>
            </Row>
          ) : loadFailed ? (
            <LabeledRow label="Your ID" value="--" />
          ) : (
            <Row>
              <View style={styles.line}>
                <Txt>Your ID</Txt>
                <ActivityIndicator color={theme.inkSecondary} />
              </View>
            </Row>
          )}
        </Section>

        {/* The way back from "Hide posts from this person" — all at once, because the app only learns how many. */}
        {hiddenCount !== null && hiddenCount > 0 ? (
          <Section header="Hidden people" footer="Deadlines from people you've hidden don't reach you.">
            <LabeledRow label="Hidden" value={hiddenCount === 1 ? '1 person' : `${hiddenCount} people`} />
            <ActionRow title="Show everyone again" busy={unhiding} onPress={() => void unhideAll()} />
          </Section>
        ) : null}

        <Section header="About" footer="An independent student project. Not affiliated with or endorsed by Dublin City University.">
          <ActionRow title="Privacy policy" onPress={() => void Linking.openURL(AppLinks.privacy)} />
          <ActionRow title="Terms of use" onPress={() => void Linking.openURL(AppLinks.terms)} />
          <ActionRow title="Help and contact" onPress={() => void Linking.openURL(AppLinks.support)} />
        </Section>

        <Section footer="Removes your account and everything on this device.">
          <ActionRow title="Delete account" destructive busy={deleting} onPress={() => setConfirmingDelete(true)} />
        </Section>
        {deleteError ? (
          <Section>
            <Pressable onPress={() => setDeleteError(null)} accessibilityRole="button">
              <Row><Txt type="callout" color={theme.destructive}>{`Couldn't delete: ${deleteError}`}</Txt></Row>
            </Pressable>
          </Section>
        ) : null}
      </ListScroll>

      <ActionSheet
        visible={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        title="Delete your account?"
        message="This can't be undone. Deadlines and reports you shared stay, but nothing will link them to you."
        actions={[{ label: 'Delete', destructive: true, onPress: () => void remove() }]}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.s },
  mono: { fontVariant: ['tabular-nums'], letterSpacing: 1 },
});
