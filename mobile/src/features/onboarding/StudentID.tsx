import { BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Animated, Easing, Linking, Platform, Pressable, StyleSheet, Text, TextInput,
  useWindowDimensions, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StudentNumber } from '../../core/identity';
import { errorMessage, isNotSignedIn } from '../../data/rest';
import { useServices } from '../../state/hooks';
import { ActionRow, BarButton, ListScroll, PrimaryButton, Row, SecondaryButton, Section, Sheet, Txt } from '../../ui/components';
import { Space, useTheme } from '../../ui/theme';

/** The guide frame's width as a share of the screen's. */
const GUIDE_WIDTH_FRACTION = 0.88;
/** ID-1, the size of every bank and student card: 85.6 × 54 mm. */
const CARD_ASPECT = 85.6 / 54;
/**
 * A live read counts once this many frames agree. The barcode has no check character, so
 * one frame caught mid-blur could hand over a wrong number that still has the right shape —
 * and it's saved without a second look. Three frames is a tenth of a second on a card held still.
 */
const LIVE_AGREEMENT = 3;
/** How long the shutter waits for the live scanner before saying it couldn't read the card. */
const SHUTTER_WINDOW_MS = 2000;
/** Long enough to see the tick land before the next screen replaces this one. */
const CONFIRMATION_HOLD_MS = 1100;

type CameraStatus = 'starting' | 'running' | 'unavailable' | 'denied';
type Problem = 'notACard' | 'unreadable';
/** The number on its way to the server, and whether it has arrived. */
type Confirmation = { number: string; saved: boolean };

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Between signing in and the timetable: the student's number, read from the barcode on
 * their card. "See other options" lets them type it instead.
 *
 * A number is saved the moment it's read or entered, and `SavedOverlay` confirms it over
 * the camera. There's no "is this right?" step, and the number can be set only once —
 * after that only an admin can change it — so a misread is stopped before it gets here:
 * `StudentNumber.fromBarcode` refuses anything not shaped like a card's barcode, and a
 * read counts only once `LIVE_AGREEMENT` frames agree.
 *
 * Every read comes from the live scanner, the shutter's included. On iOS, expo-camera can
 * read a still photo for QR codes only (`scanFromURLAsync` uses a QR-only detector), so a
 * photo of the card could never be decoded; the shutter instead waits for the live scanner
 * and says so when nothing comes. No photo is taken, so none is ever stored.
 */
export function StudentID({ onSaved, onSignOut }: { onSaved: (number: string) => void; onSignOut: () => void }) {
  const { profiles } = useServices();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const reduceMotion = useReduceMotion();

  /** The server is asked first: a reinstall or a second phone already has a number there. */
  const [checking, setChecking] = useState(true);
  const [cameraReady, setCameraReady] = useState(false);
  const [mountFailed, setMountFailed] = useState(false);
  /** The shutter was pressed and is waiting on the live scanner. */
  const [capturing, setCapturing] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [showingOptions, setShowingOptions] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  /** The number the last frames agreed on, and how many of them. */
  const liveRead = useRef<{ number: string; frames: number } | null>(null);
  /** A number is being saved — for callbacks that run before the next render. */
  const busy = useRef(false);
  const finished = useRef(false);
  const shutterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The shutter's window saw a Code 39 barcode that wasn't a student card's. */
  const sawOtherBarcode = useRef(false);
  /** A typed number, saved once the sheet has gone so the confirmation plays in view. */
  const typed = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    profiles
      .myProfile()
      .then((profile) => {
        if (!cancelled && profile?.studentID) {
          finished.current = true;
          onSaved(profile.studentID);
        }
      })
      .catch((error) => {
        // Signed in on this phone, but with no session to act as. Nothing can be saved
        // without one, so back to sign-in rather than a scan whose save can only fail.
        if (!cancelled && isNotSignedIn(error)) onSignOut();
      })
      .finally(() => !cancelled && setChecking(false));
    return () => {
      cancelled = true;
    };
  }, [profiles, onSaved, onSignOut]);

  useEffect(() => {
    if (!checking && permission && !permission.granted && permission.canAskAgain) void requestPermission();
  }, [checking, permission, requestPermission]);

  useEffect(() => () => {
    if (shutterTimer.current) clearTimeout(shutterTimer.current);
  }, []);

  const status: CameraStatus =
    mountFailed ? 'unavailable'
      : permission && !permission.granted && !permission.canAskAgain ? 'denied'
        : cameraReady ? 'running'
          : 'starting';
  const scanning = !checking && permission?.granted === true && !mountFailed && confirmation === null && !showingOptions;
  /** The card outline, while there's a camera to line a card up in and nothing read yet. */
  const showsGhost = !checking && permission !== null && confirmation === null && (status === 'starting' || status === 'running');

  const endShutter = () => {
    if (shutterTimer.current) clearTimeout(shutterTimer.current);
    shutterTimer.current = null;
    setCapturing(false);
  };

  /** Back to lining up a card, after a failed save or a sheet closed. */
  const resume = () => {
    if (finished.current) return;
    busy.current = false;
    liveRead.current = null;
    setProblem(null);
  };

  /** Shows the confirmation at once, then saves; the tick lands when the server has it. */
  const save = async (number: string) => {
    if (busy.current) return;
    busy.current = true;
    endShutter();
    setProblem(null);
    setSaveError(null);
    setConfirmation({ number, saved: false });
    try {
      await profiles.setStudentID(number);
      setConfirmation({ number, saved: true });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await wait(CONFIRMATION_HOLD_MS);
      finished.current = true;
      onSaved(number);
    } catch (error) {
      if (isNotSignedIn(error)) {
        onSignOut();
        return;
      }
      setConfirmation(null);
      setSaveError(errorMessage(error, "Couldn't reach the server. Check your connection and try again."));
      resume();
    }
  };

  const onBarcode = (result: BarcodeScanningResult) => {
    if (busy.current) return;
    const number = StudentNumber.fromBarcode(result.data);
    if (number === null) {
      sawOtherBarcode.current = true;
      return;
    }
    const frames = liveRead.current?.number === number ? liveRead.current.frames + 1 : 1;
    liveRead.current = { number, frames };
    if (frames >= LIVE_AGREEMENT) void save(number);
  };

  const capture = () => {
    if (status !== 'running' || capturing || busy.current) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setProblem(null);
    setSaveError(null);
    sawOtherBarcode.current = false;
    setCapturing(true);
    shutterTimer.current = setTimeout(() => {
      shutterTimer.current = null;
      setCapturing(false);
      if (!busy.current) setProblem(sawOtherBarcode.current ? 'notACard' : 'unreadable');
    }, SHUTTER_WINDOW_MS);
  };

  const saveTyped = (number: string) => {
    // Started any sooner, the confirmation plays out underneath the sheet as it slides
    // away. It waits for the sheet to go (`onDismissed`, iOS), with a fallback for where
    // that callback doesn't come.
    typed.current = number;
    setShowingOptions(false);
    setTimeout(runTyped, 700);
  };

  const runTyped = () => {
    const number = typed.current;
    typed.current = null;
    if (number) void save(number);
  };

  // The guide's place on the full screen, a little above the middle to leave room for the shutter.
  const guideW = width * GUIDE_WIDTH_FRACTION;
  const guideH = guideW / CARD_ASPECT;
  const guide = { x: (width - guideW) / 2, y: height * 0.42 - guideH / 2, w: guideW, h: guideH };
  const message = saveError
    ?? (problem === 'notACard' ? "That barcode isn't from a DCU student card."
      : problem === 'unreadable' ? "Couldn't read the barcode. Hold the card still in the frame, tilted away from the light."
        : null);

  return (
    <View style={styles.screen}>
      {/* Dark over the camera whatever the setting, as the Camera app is. */}
      <StatusBar style="light" hidden />
      {!checking && permission?.granted ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          autofocus="on"
          active={scanning}
          barcodeScannerSettings={{ barcodeTypes: ['code39'] }}
          onBarcodeScanned={scanning ? onBarcode : undefined}
          onCameraReady={() => setCameraReady(true)}
          onMountError={() => setMountFailed(true)}
        />
      ) : null}
      <GuideOverlay guide={guide} />
      {showsGhost ? <CardGhost guide={guide} /> : null}

      <View style={[styles.instructions, { top: insets.top, height: Math.max(0, guide.y - insets.top) }]}>
        <Txt type="title3" color="#FFFFFF" style={styles.center}>Take a photo of your student ID</Txt>
        <Txt type="subheadline" color="rgba(255,255,255,0.8)" style={styles.center}>Avoid reflections, and centre the card in the frame.</Txt>
      </View>

      {confirmation === null ? (
        <View style={[styles.frameMessage, { left: guide.x, top: guide.y, width: guide.w, height: guide.h }]}>
          {checking || (status === 'starting' && permission === null) ? <ActivityIndicator color="#FFFFFF" /> : null}
          {!checking && status === 'unavailable' ? (
            <Txt type="subheadline" color="#FFFFFF" style={styles.center}>{"There's no camera to use here. Type your student number instead."}</Txt>
          ) : null}
          {!checking && status === 'denied' ? (
            <Txt type="subheadline" color="#FFFFFF" style={styles.center}>Camera access is off for DCU Timetable. Turn it on in Settings, or type your student number instead.</Txt>
          ) : null}
        </View>
      ) : null}

      <View
        pointerEvents={confirmation === null ? 'auto' : 'none'}
        style={[styles.controls, { top: guide.y + guide.h, paddingBottom: Math.max(insets.bottom, Space.s), opacity: confirmation === null ? 1 : 0.4 }]}
      >
        {message ? <Txt type="footnote" color="#FFFFFF" style={styles.center}>{message}</Txt> : <View />}
        {status === 'denied' ? (
          <SecondaryButton title="Open Settings" onPress={() => void Linking.openSettings()} />
        ) : status === 'unavailable' ? (
          <SecondaryButton title="Type your student number" onPress={() => setShowingOptions(true)} />
        ) : (
          <Pressable
            onPress={capture}
            disabled={checking || status !== 'running' || capturing}
            accessibilityRole="button"
            accessibilityLabel="Take photo"
            style={[styles.shutter, { opacity: checking || status !== 'running' ? 0.4 : 1 }]}
          >
            <View style={[styles.shutterFill, { opacity: capturing ? 0.4 : 1 }]} />
            {capturing ? <ActivityIndicator color="#000000" style={StyleSheet.absoluteFill} /> : null}
          </Pressable>
        )}
        <Pressable onPress={() => { setSaveError(null); endShutter(); setShowingOptions(true); }} accessibilityRole="button" style={styles.options}>
          <Txt type="footnote" color="rgba(255,255,255,0.8)">See other options</Txt>
        </Pressable>
      </View>

      {confirmation ? (
        <SavedOverlay guide={guide} number={confirmation.number} saved={confirmation.saved} reduceMotion={reduceMotion} />
      ) : null}

      <OtherOptions
        visible={showingOptions}
        onSave={saveTyped}
        onSignOut={onSignOut}
        onClose={() => {
          setShowingOptions(false);
          resume();
        }}
        onDismissed={runTyped}
      />
    </View>
  );
}

/** The system's Reduce Motion setting, kept current. */
function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduce);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => subscription.remove();
  }, []);
  return reduce;
}

type Box = { x: number; y: number; w: number; h: number };

/**
 * Where things sit on a DCU student card, as fractions of its width and height — measured
 * from photos of three cards. Rough on purpose: enough to show which way up the card goes
 * and where the barcode should land, not a copy of the card.
 */
const CARD_LAYOUT = {
  photo: { x: 0.71, y: 0.1, w: 0.21, h: 0.41 },
  swoosh: { x: 0.15, y: 0.07, w: 0.4, h: 0.44 },
  innerSwoosh: { x: 0.22, y: 0.13, w: 0.3, h: 0.34 },
  wordmark: { x: 0.2, y: 0.27, w: 0.34, h: 0.22 },
  lines: [
    { x: 0.055, y: 0.515, w: 0.27, h: 0.045 }, // name
    { x: 0.055, y: 0.585, w: 0.46, h: 0.045 }, // student number
    { x: 0.055, y: 0.655, w: 0.5, h: 0.045 }, // qualification
    { x: 0.045, y: 0.925, w: 0.33, h: 0.04 }, // expiry date
    { x: 0.475, y: 0.93, w: 0.22, h: 0.035 }, // the number under the barcode
  ],
  barcode: { x: 0.15, y: 0.735, w: 0.73, h: 0.16 },
} satisfies Record<string, Box | Box[]>;

/** Bar and space widths, alternating from a bar: a fixed made-up pattern that reads as a barcode. */
const GHOST_BARS = Array.from({ length: 91 }, (_, i) => ((i * 7 + 3) % 5 < 2 ? 3 : 1));

/**
 * A faint outline of a student card inside the guide: the photo top right, the logo, the
 * text lines, and the barcode along the bottom. Drawn on the screen only; the camera never
 * sees it, so it can't be read as a barcode.
 */
function CardGhost({ guide }: { guide: Box }) {
  const place = (b: Box) => ({ left: b.x * guide.w, top: b.y * guide.h, width: b.w * guide.w, height: b.h * guide.h });
  const { photo, swoosh, innerSwoosh, wordmark, lines, barcode } = CARD_LAYOUT;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.ghost, { left: guide.x, top: guide.y, width: guide.w, height: guide.h }]}
    >
      <View style={[styles.ghostPhoto, place(photo)]}>
        <View style={[styles.ghostHead, { width: photo.w * guide.w * 0.36, height: photo.w * guide.w * 0.36 }]} />
        <View style={[styles.ghostShoulders, { width: photo.w * guide.w * 0.72, height: photo.h * guide.h * 0.3 }]} />
      </View>
      {/* The logo's swoosh: two arcs leaning over the letters. */}
      <View style={[styles.ghostArc, place(swoosh), { borderRadius: swoosh.w * guide.w, borderTopWidth: 3 }]} />
      <View style={[styles.ghostArc, place(innerSwoosh), { borderRadius: innerSwoosh.w * guide.w, borderTopWidth: 2 }]} />
      <View style={[styles.ghostWordmark, place(wordmark)]}>
        <Text allowFontScaling={false} style={[styles.ghostLetters, { fontSize: wordmark.h * guide.h * 0.95 }]}>DCU</Text>
      </View>
      {lines.map((line, i) => (
        <View key={i} style={[styles.ghostLine, place(line), { borderRadius: (line.h * guide.h) / 2 }]} />
      ))}
      <View style={[styles.ghostBarcode, place(barcode)]}>
        {GHOST_BARS.map((units, i) => (
          <View key={i} style={{ flex: units, backgroundColor: i % 2 === 0 ? '#FFFFFF' : 'transparent' }} />
        ))}
      </View>
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
 * The translucent confirmation over the camera: a ring that turns while the number is sent,
 * then closes and a tick springs in when the server has it, with the number underneath so
 * the student sees what was saved.
 */
function SavedOverlay({ guide, number, saved, reduceMotion }: { guide: Box; number: string; saved: boolean; reduceMotion: boolean }) {
  const [appear] = useState(() => new Animated.Value(0));
  const [spin] = useState(() => new Animated.Value(0));
  const [tick] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.spring(appear, { toValue: 1, speed: 16, bounciness: reduceMotion ? 0 : 8, useNativeDriver: true }).start();
    const turning = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }));
    turning.start();
    return () => turning.stop();
  }, [appear, spin, reduceMotion]);

  useEffect(() => {
    if (saved) Animated.spring(tick, { toValue: 1, speed: 14, bounciness: reduceMotion ? 0 : 12, useNativeDriver: true }).start();
  }, [saved, tick, reduceMotion]);

  const badge = 84;
  const ring = { width: badge, height: badge, borderRadius: badge / 2 };
  return (
    <View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[styles.savedArea, { left: guide.x, top: guide.y, width: guide.w, height: guide.h }]}
    >
      <Animated.View
        accessible
        accessibilityLabel={saved ? `Student number ${number} saved` : `Saving student number ${number}`}
        style={[styles.savedCard, {
          opacity: appear,
          transform: [{ scale: reduceMotion ? 1 : appear.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
        }]}
      >
        <View style={ring}>
          <View style={[StyleSheet.absoluteFill, ring, styles.ringTrack]} />
          <Animated.View
            style={[StyleSheet.absoluteFill, ring, styles.ringArc, {
              opacity: saved ? 0 : 1,
              transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }],
            }]}
          />
          <Animated.View style={[StyleSheet.absoluteFill, ring, styles.ringClosed, { opacity: tick }]} />
          <View style={[StyleSheet.absoluteFill, styles.tickHolder]}>
            <Animated.View
              style={[styles.tick, {
                width: badge * 0.24, height: badge * 0.44, opacity: tick,
                transform: [{ rotate: '45deg' }, { scale: tick }],
              }]}
            />
          </View>
        </View>
        <View style={styles.savedText}>
          <Txt type="pageTitle" color="#FFFFFF" style={[styles.center, styles.mono]}>{number}</Txt>
          <Txt type="subheadline" color="rgba(255,255,255,0.8)" style={styles.center}>{saved ? 'Student number saved' : 'Saving…'}</Txt>
        </View>
      </Animated.View>
    </View>
  );
}

/**
 * Typing the number instead, for a card that won't scan, a camera that isn't allowed, or
 * no card to hand. And the way out, for someone who signed in with the wrong account.
 *
 * Save closes the sheet and hands the number back, so the confirmation plays on the camera
 * screen like a scanned one, and a failure is reported there too.
 */
function OtherOptions({
  visible, onSave, onSignOut, onClose, onDismissed,
}: { visible: boolean; onSave: (number: string) => void; onSignOut: () => void; onClose: () => void; onDismissed: () => void }) {
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
      onDismissed={onDismissed}
      left={<BarButton title="Cancel" onPress={onClose} />}
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
              onSubmitEditing={() => number && onSave(number)}
              style={[styles.input, styles.mono, { color: theme.ink }]}
              accessibilityLabel="Student number"
            />
            <Txt type="caption" color={theme.inkSecondary}>{caption}</Txt>
          </Row>
        </Section>
        <Section bare>
          <PrimaryButton title="Save" disabled={number === null} onPress={() => number && onSave(number)} />
        </Section>
        <Section>
          <ActionRow title="Sign out" icon="signOut" destructive onPress={onSignOut} />
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
  // Low enough that the real card shows through it once it's lined up.
  ghost: { position: 'absolute', opacity: 0.22 },
  ghostPhoto: {
    position: 'absolute', borderWidth: 1.5, borderColor: '#FFFFFF', borderRadius: 4, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'flex-end', gap: 2,
  },
  ghostHead: { borderRadius: 999, backgroundColor: '#FFFFFF' },
  ghostShoulders: { borderTopLeftRadius: 999, borderTopRightRadius: 999, backgroundColor: '#FFFFFF' },
  ghostArc: { position: 'absolute', borderColor: '#FFFFFF', transform: [{ rotate: '-14deg' }] },
  ghostWordmark: { position: 'absolute', justifyContent: 'center' },
  ghostLetters: {
    color: '#FFFFFF', fontWeight: '700', letterSpacing: 2,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia, serif' }),
  },
  ghostLine: { position: 'absolute', backgroundColor: '#FFFFFF' },
  ghostBarcode: { position: 'absolute', flexDirection: 'row' },
  corner: { position: 'absolute', borderColor: '#FFFFFF' },
  savedArea: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  // Translucent rather than blurred: a blur needs expo-blur, a native module, and so a new
  // store build instead of an over-the-air update.
  savedCard: {
    alignItems: 'center', gap: Space.l, paddingHorizontal: Space.xxl, paddingVertical: Space.xl, borderRadius: 28,
    backgroundColor: 'rgba(24,24,30,0.62)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.22)',
  },
  ringTrack: { borderWidth: 5, borderColor: 'rgba(255,255,255,0.25)' },
  ringArc: { borderWidth: 5, borderColor: 'transparent', borderTopColor: '#FFFFFF', borderRightColor: '#FFFFFF' },
  ringClosed: { borderWidth: 5, borderColor: '#FFFFFF' },
  tickHolder: { alignItems: 'center', justifyContent: 'center' },
  // The classic tick: two sides of a box, turned 45°, nudged up to sit in the ring's centre.
  tick: { borderRightWidth: 6, borderBottomWidth: 6, borderColor: '#FFFFFF', marginTop: -8, borderRadius: 2 },
  savedText: { alignItems: 'center', gap: Space.xs },
  input: { fontSize: 17, minHeight: 40 },
  mono: { fontVariant: ['tabular-nums'], letterSpacing: 1 },
});
