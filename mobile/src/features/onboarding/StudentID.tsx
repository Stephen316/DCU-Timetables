import { BarcodeScanningResult, CameraView, scanFromURLAsync, useCameraPermissions } from 'expo-camera';
import { File } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StudentNumber } from '../../core/identity';
import { errorMessage } from '../../data/rest';
import { useServices } from '../../state/hooks';
import {
  ActionRow, BarButton, BottomCard, Icon, ListScroll, PrimaryButton, Row, SecondaryButton, Section, Sheet, Txt,
} from '../../ui/components';
import { Space, useTheme } from '../../ui/theme';

/** The guide frame's width as a share of the screen's. */
const GUIDE_WIDTH_FRACTION = 0.88;
/** ID-1, the size of every bank and student card: 85.6 × 54 mm. */
const CARD_ASPECT = 85.6 / 54;

type CameraStatus = 'starting' | 'running' | 'unavailable' | 'denied';
type Problem = 'notACard' | 'unreadable';

/**
 * Between signing in and the timetable: the student's number, read from the barcode on
 * their card. "See other options" lets them type it instead.
 *
 * The number is set once — after that only an admin can change it — so a read is shown
 * back to be checked before anything is saved. The photo is read on the phone and deleted;
 * only the number is sent.
 */
export function StudentID({ onSaved, onSignOut }: { onSaved: (number: string) => void; onSignOut: () => void }) {
  const { profiles } = useServices();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);

  /** The server is asked first: a reinstall or a second phone already has a number there. */
  const [checking, setChecking] = useState(true);
  const [cameraReady, setCameraReady] = useState(false);
  const [mountFailed, setMountFailed] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  /** A card's number, once one has been read. */
  const [read, setRead] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [showingOptions, setShowingOptions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /**
   * A live read counts once the same number comes back twice running. The barcode has no
   * check character, so one frame caught mid-blur could hand over a plausible wrong number.
   */
  const lastLiveRead = useRef<string | null>(null);
  /** The same as `read`, for callbacks that run before the next render. */
  const readRef = useRef<string | null>(null);
  const saved = useRef(false);

  useEffect(() => {
    let cancelled = false;
    profiles
      .myProfile()
      .then((profile) => {
        if (!cancelled && profile?.studentID) {
          saved.current = true;
          onSaved(profile.studentID);
        }
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setChecking(false));
    return () => {
      cancelled = true;
    };
  }, [profiles, onSaved]);

  useEffect(() => {
    if (!checking && permission && !permission.granted && permission.canAskAgain) void requestPermission();
  }, [checking, permission, requestPermission]);

  const status: CameraStatus =
    mountFailed ? 'unavailable'
      : permission && !permission.granted && !permission.canAskAgain ? 'denied'
        : cameraReady ? 'running'
          : 'starting';
  const scanning = !checking && permission?.granted === true && !mountFailed && read === null && !showingOptions;

  const deliver = (number: string) => {
    if (readRef.current !== null) return;
    readRef.current = number;
    setRead(number);
    setProblem(null);
    setSaveError(null);
    setConfirming(true);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  /** Back to lining up a card, after a read was turned down or a sheet closed. */
  const resume = () => {
    if (saved.current) return;
    readRef.current = null;
    setRead(null);
    setProblem(null);
    lastLiveRead.current = null;
  };

  const onBarcode = (result: BarcodeScanningResult) => {
    if (readRef.current !== null) return;
    const number = StudentNumber.fromBarcode(result.data);
    if (number === null) return;
    if (number === lastLiveRead.current) deliver(number);
    else lastLiveRead.current = number;
  };

  const capture = async () => {
    if (status !== 'running' || capturing || readRef.current !== null || !camera.current) return;
    setCapturing(true);
    setProblem(null);
    let uri: string | null = null;
    try {
      // No flash: that's the glare on the laminate the instructions ask them to avoid.
      const photo = await camera.current.takePictureAsync({ quality: 0.9, shutterSound: false });
      uri = photo.uri;
      const results = await scanFromURLAsync(photo.uri, ['code39']);
      const number = results.map((r) => StudentNumber.fromBarcode(r.data)).find((n): n is string => n !== null);
      if (readRef.current !== null) return; // a live read got there first
      if (number) deliver(number);
      else setProblem(results.length > 0 ? 'notACard' : 'unreadable');
    } catch {
      setProblem('unreadable');
    } finally {
      setCapturing(false);
      // The photo is only ever read here; it doesn't outlive the read.
      if (uri && Platform.OS !== 'web') {
        try {
          new File(uri).delete();
        } catch {
          // Already gone.
        }
      }
    }
  };

  const save = async (number: string) => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await profiles.setStudentID(number);
      saved.current = true;
      setConfirming(false);
      setShowingOptions(false);
      onSaved(number);
    } catch (error) {
      setSaveError(errorMessage(error, "Couldn't reach the server. Check your connection and try again."));
    } finally {
      setSaving(false);
    }
  };

  // The guide's place on the full screen, a little above the middle to leave room for the shutter.
  const guideW = width * GUIDE_WIDTH_FRACTION;
  const guideH = guideW / CARD_ASPECT;
  const guide = { x: (width - guideW) / 2, y: height * 0.42 - guideH / 2, w: guideW, h: guideH };

  return (
    <View style={styles.screen}>
      {/* Dark over the camera whatever the setting, as the Camera app is. */}
      <StatusBar style="light" hidden />
      {!checking && permission?.granted ? (
        <CameraView
          ref={camera}
          style={StyleSheet.absoluteFill}
          facing="back"
          autofocus="on"
          active={scanning || capturing}
          barcodeScannerSettings={{ barcodeTypes: ['code39'] }}
          onBarcodeScanned={scanning ? onBarcode : undefined}
          onCameraReady={() => setCameraReady(true)}
          onMountError={() => setMountFailed(true)}
        />
      ) : null}
      <GuideOverlay guide={guide} />

      <View style={[styles.instructions, { top: insets.top, height: Math.max(0, guide.y - insets.top) }]}>
        <Txt type="title3" color="#FFFFFF" style={styles.center}>Take a photo of your student ID</Txt>
        <Txt type="subheadline" color="rgba(255,255,255,0.8)" style={styles.center}>Avoid reflections, and centre the card in the frame.</Txt>
      </View>

      <View style={[styles.frameMessage, { left: guide.x, top: guide.y, width: guide.w, height: guide.h }]}>
        {checking || (status === 'starting' && permission === null) ? <ActivityIndicator color="#FFFFFF" /> : null}
        {!checking && status === 'unavailable' ? (
          <Txt type="subheadline" color="#FFFFFF" style={styles.center}>{"There's no camera to use here. Type your student number instead."}</Txt>
        ) : null}
        {!checking && status === 'denied' ? (
          <Txt type="subheadline" color="#FFFFFF" style={styles.center}>Camera access is off for DCU Timetable. Turn it on in Settings, or type your student number instead.</Txt>
        ) : null}
      </View>

      <View style={[styles.controls, { top: guide.y + guide.h, paddingBottom: Math.max(insets.bottom, Space.s) }]}>
        {problem ? (
          <Txt type="footnote" color="#FFFFFF" style={styles.center}>
            {problem === 'notACard' ? "That barcode isn't from a DCU student card." : "Couldn't read the barcode. Tilt the card away from the light and try again."}
          </Txt>
        ) : <View />}
        {status === 'denied' ? (
          <SecondaryButton title="Open Settings" onPress={() => void Linking.openSettings()} />
        ) : status === 'unavailable' ? (
          <SecondaryButton title="Type your student number" onPress={() => setShowingOptions(true)} />
        ) : (
          <Pressable
            onPress={() => void capture()}
            disabled={checking || status !== 'running' || capturing}
            accessibilityRole="button"
            accessibilityLabel="Take photo"
            style={[styles.shutter, { opacity: checking || status !== 'running' ? 0.4 : 1 }]}
          >
            <View style={[styles.shutterFill, { opacity: capturing ? 0.4 : 1 }]} />
            {capturing ? <ActivityIndicator color="#000000" style={StyleSheet.absoluteFill} /> : null}
          </Pressable>
        )}
        <Pressable onPress={() => { setSaveError(null); setShowingOptions(true); }} accessibilityRole="button" style={styles.options}>
          <Txt type="footnote" color="rgba(255,255,255,0.8)">See other options</Txt>
        </Pressable>
      </View>

      <NumberConfirmation
        visible={confirming && read !== null}
        number={read ?? ''}
        saving={saving}
        error={saveError}
        onSave={() => read && void save(read)}
        onRetake={() => {
          setConfirming(false);
          resume();
        }}
      />
      <OtherOptions
        visible={showingOptions}
        saving={saving}
        error={saveError}
        onSave={(n) => void save(n)}
        onSignOut={onSignOut}
        onClose={() => {
          setShowingOptions(false);
          resume();
        }}
      />
    </View>
  );
}

/** The dimmed surround, and a bracket at each corner of where the card goes. */
function GuideOverlay({ guide }: { guide: { x: number; y: number; w: number; h: number } }) {
  const dim = 'rgba(0,0,0,0.55)';
  const arm = 28;
  const corner = (pos: object, edges: object) => <View style={[styles.corner, { width: arm, height: arm }, pos, edges]} />;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: guide.y, backgroundColor: dim }} />
      <View style={{ position: 'absolute', left: 0, right: 0, top: guide.y + guide.h, bottom: 0, backgroundColor: dim }} />
      <View style={{ position: 'absolute', left: 0, width: guide.x, top: guide.y, height: guide.h, backgroundColor: dim }} />
      <View style={{ position: 'absolute', right: 0, width: guide.x, top: guide.y, height: guide.h, backgroundColor: dim }} />
      <View style={[styles.guideEdge, { left: guide.x, top: guide.y, width: guide.w, height: guide.h }]}>
        {corner({ left: -2, top: -2 }, { borderLeftWidth: 4, borderTopWidth: 4, borderTopLeftRadius: 14 })}
        {corner({ right: -2, top: -2 }, { borderRightWidth: 4, borderTopWidth: 4, borderTopRightRadius: 14 })}
        {corner({ left: -2, bottom: -2 }, { borderLeftWidth: 4, borderBottomWidth: 4, borderBottomLeftRadius: 14 })}
        {corner({ right: -2, bottom: -2 }, { borderRightWidth: 4, borderBottomWidth: 4, borderBottomRightRadius: 14 })}
      </View>
    </View>
  );
}

/**
 * "Is this your student number?" — asked of every number read from a card, because it
 * can't be changed afterwards without an admin. Stays up to show a failed save.
 */
function NumberConfirmation({
  visible, number, saving, error, onSave, onRetake,
}: { visible: boolean; number: string; saving: boolean; error: string | null; onSave: () => void; onRetake: () => void }) {
  const theme = useTheme();
  return (
    <BottomCard visible={visible} onClose={onRetake} dismissable={!saving}>
      <View style={styles.confirm}>
        <Icon name="idCard" size={30} color={theme.accent} />
        <Txt type="headline" style={styles.center}>Is this your student number?</Txt>
        <Txt type="largeTitle" style={[styles.center, styles.mono]}>{number}</Txt>
        <Txt type="subheadline" color={theme.inkSecondary} style={styles.center}>{"Check it against your card. Once it's saved, only an admin can change it."}</Txt>
        {error ? <Txt type="footnote" color={theme.inkSecondary} style={styles.center}>{error}</Txt> : null}
      </View>
      <View style={styles.buttons}>
        <PrimaryButton title="Save" busy={saving} onPress={onSave} />
        <SecondaryButton title="Retake" disabled={saving} onPress={onRetake} />
      </View>
    </BottomCard>
  );
}

/**
 * Typing the number instead, for a card that won't scan, a camera that isn't allowed, or
 * no card to hand. And the way out, for someone who signed in with the wrong account.
 */
function OtherOptions({
  visible, saving, error, onSave, onSignOut, onClose,
}: { visible: boolean; saving: boolean; error: string | null; onSave: (number: string) => void; onSignOut: () => void; onClose: () => void }) {
  const theme = useTheme();
  const [entry, setEntry] = useState('');
  const number = StudentNumber.fromTyped(entry);
  const caption =
    entry.trim().length === 0
      ? 'It\'s on your student card, after "Student Number": a letter and eight digits. Once it\'s saved, only an admin can change it.'
      : number === null
        ? 'A student number is a letter and eight digits, like A00000000.'
        : `Saves as ${number}. Once it's saved, only an admin can change it.`;
  return (
    <Sheet
      visible={visible}
      title="Other options"
      onClose={onClose}
      dismissable={!saving}
      left={<BarButton title="Cancel" onPress={onClose} disabled={saving} />}
    >
      <ListScroll>
        <Section header="Enter your student number">
          <Row>
            <TextInput
              value={entry}
              onChangeText={setEntry}
              placeholder="A00000000"
              placeholderTextColor={theme.inkTertiary}
              autoCapitalize="characters"
              autoCorrect={false}
              keyboardType={Platform.OS === 'ios' ? 'ascii-capable' : 'default'}
              returnKeyType="done"
              onSubmitEditing={() => number && !saving && onSave(number)}
              style={[styles.input, styles.mono, { color: theme.ink }]}
              accessibilityLabel="Student number"
            />
            <Txt type="caption" color={theme.inkSecondary}>{caption}</Txt>
          </Row>
        </Section>
        {error ? (
          <Section>
            <Row><Txt type="callout" color={theme.inkSecondary}>{error}</Txt></Row>
          </Section>
        ) : null}
        <Section bare>
          <PrimaryButton title="Save" busy={saving} disabled={number === null} onPress={() => number && onSave(number)} />
        </Section>
        <Section>
          <ActionRow title="Sign out" icon="signOut" destructive disabled={saving} onPress={onSignOut} />
        </Section>
      </ListScroll>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000000' },
  center: { textAlign: 'center' },
  instructions: { position: 'absolute', left: 0, right: 0, justifyContent: 'flex-end', paddingHorizontal: Space.xl, paddingBottom: Space.xl, gap: Space.s },
  frameMessage: { position: 'absolute', alignItems: 'center', justifyContent: 'center', padding: Space.l },
  controls: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: Space.xl, alignItems: 'center', justifyContent: 'space-evenly' },
  shutter: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  shutterFill: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#FFFFFF' },
  options: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Space.l },
  guideEdge: { position: 'absolute', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  corner: { position: 'absolute', borderColor: '#FFFFFF' },
  confirm: { alignItems: 'center', gap: Space.m },
  buttons: { gap: Space.s },
  input: { fontSize: 17, minHeight: 40 },
  mono: { fontVariant: ['tabular-nums'], letterSpacing: 1 },
});
