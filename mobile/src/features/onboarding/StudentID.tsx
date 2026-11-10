import { BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Linking, Platform, Pressable, StyleSheet,
  useWindowDimensions, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StudentNumber } from '../../core/identity';
import { SecondaryButton, Txt, useReduceMotion } from '../../ui/components';
import { Space } from '../../ui/theme';

/** The guide frame's width as a share of the screen's. */
const GUIDE_WIDTH_FRACTION = 0.88;
/** Preserve the supplied overlay’s viewBox proportions. */
const CARD_ASPECT = 479 / 304;
const CARD_OVERLAY = require('../../../assets/student-id-overlay.svg');
/**
 * A live read counts once this many frames agree. The barcode has no check character, so
 * one frame caught mid-blur could hand over a wrong number that still has the right shape —
 * and make it harder to spot a mistake. Three frames is a tenth of a second on a card held still.
 */
const LIVE_AGREEMENT = 3;
/** How long the shutter waits for the live scanner before saying it couldn't read the card. */
const SHUTTER_WINDOW_MS = 2000;
/** Long enough to see the tick land before the next screen replaces this one. */
const CONFIRMATION_HOLD_MS = 1100;

type CameraStatus = 'starting' | 'running' | 'unavailable' | 'denied';
type Problem = 'notACard' | 'unreadable';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Reads the card's live Code 39 barcode and returns the number for review. */
export function StudentID({ onRead, onOtherMethods }: { onRead: (number: string) => void; onOtherMethods: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const reduceMotion = useReduceMotion();

  const [cameraReady, setCameraReady] = useState(false);
  const [mountFailed, setMountFailed] = useState(false);
  /** The shutter was pressed and is waiting on the live scanner. */
  const [capturing, setCapturing] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  /** The number the last frames agreed on, and how many of them. */
  const liveRead = useRef<{ number: string; frames: number } | null>(null);
  /** Guards against repeated reads and queued callbacks while leaving the camera. */
  const busy = useRef(false);
  const shutterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The shutter's window saw a Code 39 barcode that wasn't a student card's. */
  const sawOtherBarcode = useRef(false);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) void requestPermission();
  }, [permission, requestPermission]);

  useEffect(() => () => {
    if (shutterTimer.current) clearTimeout(shutterTimer.current);
  }, []);

  const status: CameraStatus =
    mountFailed ? 'unavailable'
      : permission && !permission.granted && !permission.canAskAgain ? 'denied'
        : cameraReady ? 'running'
          : 'starting';
  const scanning = permission?.granted === true && !mountFailed && confirmation === null;
  /** The card outline, while there's a camera to line a card up in and nothing read yet. */
  const showsGhost = permission !== null && confirmation === null && (status === 'starting' || status === 'running');

  const endShutter = () => {
    if (shutterTimer.current) clearTimeout(shutterTimer.current);
    shutterTimer.current = null;
    setCapturing(false);
  };

  const confirmRead = async (number: string) => {
    if (busy.current) return;
    busy.current = true;
    endShutter();
    setProblem(null);
    setConfirmation(number);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await wait(CONFIRMATION_HOLD_MS);
    onRead(number);
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
    if (frames >= LIVE_AGREEMENT) void confirmRead(number);
  };

  const capture = () => {
    if (status !== 'running' || capturing || busy.current) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setProblem(null);
    sawOtherBarcode.current = false;
    setCapturing(true);
    shutterTimer.current = setTimeout(() => {
      shutterTimer.current = null;
      setCapturing(false);
      if (!busy.current) setProblem(sawOtherBarcode.current ? 'notACard' : 'unreadable');
    }, SHUTTER_WINDOW_MS);
  };

  const otherMethods = () => {
    if (busy.current) return;
    busy.current = true;
    endShutter();
    onOtherMethods();
  };

  // The guide's place on the full screen, a little above the middle to leave room for the shutter.
  const guideW = width * GUIDE_WIDTH_FRACTION;
  const guideH = guideW / CARD_ASPECT;
  const guide = { x: (width - guideW) / 2, y: height * 0.42 - guideH / 2, w: guideW, h: guideH };
  const message = (problem === 'notACard' ? "That barcode isn't from a DCU student card."
      : problem === 'unreadable' ? "Couldn't read the barcode. Hold the card still in the frame, tilted away from the light."
        : null);

  return (
    <View style={styles.screen}>
      {/* Dark over the camera whatever the setting, as the Camera app is. */}
      <StatusBar style="light" hidden />
      {permission?.granted ? (
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
          {status === 'starting' && permission === null ? <ActivityIndicator color="#FFFFFF" /> : null}
          {status === 'unavailable' ? (
            <Txt type="subheadline" color="#FFFFFF" style={styles.center}>{"There's no camera to use here. Type your student number instead."}</Txt>
          ) : null}
          {status === 'denied' ? (
            <Txt type="subheadline" color="#FFFFFF" style={styles.center}>Camera access is off for DCU Live. Turn it on in Settings, or type your student number instead.</Txt>
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
          <SecondaryButton title="Type your student number" onPress={otherMethods} />
        ) : (
          <Pressable
            onPress={capture}
            disabled={status !== 'running' || capturing}
            accessibilityRole="button"
            accessibilityLabel="Take photo"
            style={[styles.shutter, { opacity: status !== 'running' ? 0.4 : 1 }]}
          >
            <View style={[styles.shutterFill, { opacity: capturing ? 0.4 : 1 }]} />
            {capturing ? <ActivityIndicator color="#000000" style={StyleSheet.absoluteFill} /> : null}
          </Pressable>
        )}
        <Pressable onPress={otherMethods} accessibilityRole="button" style={styles.options}>
          <Txt type="footnote" color="rgba(255,255,255,0.8)">Other methods</Txt>
        </Pressable>
      </View>

      {confirmation ? (
        <ReadOverlay guide={guide} number={confirmation} reduceMotion={reduceMotion} />
      ) : null}
    </View>
  );
}


type Box = { x: number; y: number; w: number; h: number };

/** The supplied artwork is translucent so the live card remains visible beneath it. */
function CardGhost({ guide }: { guide: Box }) {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.ghost, { left: guide.x, top: guide.y, width: guide.w, height: guide.h }]}
    >
      <Image source={CARD_OVERLAY} contentFit="contain" style={StyleSheet.absoluteFill} accessible={false} />
    </View>
  );
}

/** The frame's corner radius. The dim's cut-out and the brackets curve round the same centres. */
const GUIDE_RADIUS = 14;
/** Wide enough to reach every edge of the screen from the frame. */
const DIM_REACH = 3000;

/** The dimmed surround, and a bracket at each corner of where the card goes. */
function GuideOverlay({ guide }: { guide: { x: number; y: number; w: number; h: number } }) {
  const dim = 'rgba(0,0,0,0.55)';
  const arm = 28;
  // Each bracket is 4pt thick and centred on the frame's 1pt edge, so its outer curve is 2pt
  // further out than the frame's, and its inner one 2pt further in: the same centre.
  const bracket = GUIDE_RADIUS + 2;
  const corner = (pos: object, edges: object) => <View style={[styles.corner, { width: arm, height: arm }, pos, edges]} />;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {/* The dim, as one wide border round the frame, so its cut-out has the frame's own rounded corners. */}
      <View
        style={{
          position: 'absolute',
          left: guide.x - DIM_REACH, top: guide.y - DIM_REACH, width: guide.w + DIM_REACH * 2, height: guide.h + DIM_REACH * 2,
          borderWidth: DIM_REACH, borderColor: dim, borderRadius: DIM_REACH + GUIDE_RADIUS,
        }}
      />
      <View style={[styles.guideEdge, { left: guide.x, top: guide.y, width: guide.w, height: guide.h }]}>
        {corner({ left: -2, top: -2 }, { borderLeftWidth: 4, borderTopWidth: 4, borderTopLeftRadius: bracket })}
        {corner({ right: -2, top: -2 }, { borderRightWidth: 4, borderTopWidth: 4, borderTopRightRadius: bracket })}
        {corner({ left: -2, bottom: -2 }, { borderLeftWidth: 4, borderBottomWidth: 4, borderBottomLeftRadius: bracket })}
        {corner({ right: -2, bottom: -2 }, { borderRightWidth: 4, borderBottomWidth: 4, borderBottomRightRadius: bracket })}
      </View>
    </View>
  );
}

/** Confirms a successful scan before the review step. */
function ReadOverlay({ guide, number, reduceMotion }: { guide: Box; number: string; reduceMotion: boolean }) {
  const [appear] = useState(() => new Animated.Value(0));
  const [tick] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.spring(appear, { toValue: 1, speed: 16, bounciness: reduceMotion ? 0 : 8, useNativeDriver: true }).start();
    Animated.spring(tick, { toValue: 1, speed: 14, bounciness: reduceMotion ? 0 : 12, useNativeDriver: true }).start();
  }, [appear, tick, reduceMotion]);

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
        accessibilityLabel={`Student number ${number} scanned`}
        style={[styles.savedCard, {
          opacity: appear,
          transform: [{ scale: reduceMotion ? 1 : appear.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
        }]}
      >
        <View style={ring}>
          <View style={[StyleSheet.absoluteFill, ring, styles.ringTrack]} />
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
          <Txt type="subheadline" color="rgba(255,255,255,0.8)" style={styles.center}>Student ID scanned</Txt>
        </View>
      </Animated.View>
    </View>
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
  guideEdge: { position: 'absolute', borderRadius: GUIDE_RADIUS, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  // The dim's border reaches far past the screen; in a browser it would widen the page.
  clip: { overflow: 'hidden' },
  // Low enough that the real card shows through it once it's lined up.
  ghost: { position: 'absolute', opacity: 0.22 },
  corner: { position: 'absolute', borderColor: '#FFFFFF' },
  savedArea: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  // Translucent rather than blurred: a blur needs expo-blur, a native module, and so a new
  // store build instead of an over-the-air update.
  savedCard: {
    alignItems: 'center', gap: Space.l, paddingHorizontal: Space.xxl, paddingVertical: Space.xl, borderRadius: 28,
    backgroundColor: 'rgba(24,24,30,0.62)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.22)',
  },
  ringTrack: { borderWidth: 5, borderColor: 'rgba(255,255,255,0.25)' },
  ringClosed: { borderWidth: 5, borderColor: '#FFFFFF' },
  tickHolder: { alignItems: 'center', justifyContent: 'center' },
  // The classic tick: two sides of a box, turned 45°, nudged up to sit in the ring's centre.
  tick: { borderRightWidth: 6, borderBottomWidth: 6, borderColor: '#FFFFFF', marginTop: -8, borderRadius: 2 },
  savedText: { alignItems: 'center', gap: Space.xs },
  mono: { fontVariant: ['tabular-nums'], letterSpacing: 1 },
});
