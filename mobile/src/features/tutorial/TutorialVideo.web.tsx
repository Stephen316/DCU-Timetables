import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { TutorialMedia } from '../../core/tutorial';
import { webAppRoot } from '../../data/webUpdate';
import { useReduceMotion } from '../../ui/components';
import { Radius, useTheme } from '../../ui/theme';

/**
 * A recording of Safari itself — iOS 26.5's own screens, from the Simulator, with the taps
 * marked — played on the tour's card, recorded once in each appearance so it matches the
 * phone it plays on. Square, panning with the taps, so the status bar and the Dynamic Island
 * never show; the Share sheet's suggested apps (News and Reminders, on the Simulator) are
 * painted out, since a student's own phone shows their own. It sits in public/, beside the page rather than under
 * assets/, so the service worker leaves it alone: Safari plays a video only from a response
 * that answers a byte range, which a saved copy doesn't.
 */
const RECORDINGS: Record<TutorialMedia, { name: string; width: number; height: number; label: string }> = {
  addToHomeScreen: {
    name: 'add-to-home-screen',
    width: 804,
    height: 804,
    label: 'In Safari, tap the ⋯ button, then Share, then View More, then Add to Home Screen, then Add.',
  },
};

/** As large as fits in `maxWidth` by `maxHeight`, at the recording's own shape. */
export function TutorialVideo({ media, maxWidth, maxHeight }: { media: TutorialMedia; maxWidth: number; maxHeight: number }) {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();
  const video = useRef<HTMLVideoElement | null>(null);
  // Low Power Mode refuses to start a video by itself: then it's the student's to start.
  const [refused, setRefused] = useState(false);
  const recording = RECORDINGS[media];
  const width = Math.min(maxWidth, (maxHeight * recording.width) / recording.height);
  const file = `${recording.name}-${theme.scheme}`;

  useEffect(() => {
    if (reduceMotion) return;
    video.current?.play().catch(() => setRefused(true));
  }, [reduceMotion, file]);

  const root = webAppRoot();
  return (
    <View style={{ alignSelf: 'center', marginTop: 8 }}>
      <video
        key={file}
        ref={video}
        src={new URL(`${file}.mp4`, root).href}
        poster={new URL(`${file}.jpg`, root).href}
        aria-label={recording.label}
        muted
        loop
        playsInline
        autoPlay={!reduceMotion}
        controls={reduceMotion || refused}
        disablePictureInPicture
        preload="auto"
        style={{
          display: 'block',
          width,
          height: (width * recording.height) / recording.width,
          borderRadius: Radius.control,
          border: `1px solid ${theme.separator}`,
          backgroundColor: theme.canvas,
          objectFit: 'cover',
        }}
      />
    </View>
  );
}
