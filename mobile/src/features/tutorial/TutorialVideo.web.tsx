import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { TutorialMedia } from '../../core/tutorial';
import { webAppRoot } from '../../data/webUpdate';
import { useReduceMotion } from '../../ui/components';
import { Radius, useTheme } from '../../ui/theme';

/**
 * A recording of Safari itself — iOS 26.5's own screens, from the Simulator, with the taps
 * marked — played on the tour's card. It sits in public/, beside the page rather than under
 * assets/, so the service worker leaves it alone: Safari plays a video only from a response
 * that answers a byte range, which a saved copy doesn't.
 */
const RECORDINGS: Record<TutorialMedia, { file: string; poster: string; width: number; height: number; label: string }> = {
  addToHomeScreen: {
    file: 'add-to-home-screen.mp4',
    poster: 'add-to-home-screen.jpg',
    width: 604,
    height: 1312,
    label: 'In Safari, tap the ⋯ button, then Share, then Add to Home Screen, then Add.',
  },
};

export function TutorialVideo({ media, height }: { media: TutorialMedia; height: number }) {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();
  const video = useRef<HTMLVideoElement | null>(null);
  // Low Power Mode refuses to start a video by itself: then it's the student's to start.
  const [refused, setRefused] = useState(false);
  const recording = RECORDINGS[media];

  useEffect(() => {
    if (reduceMotion) return;
    video.current?.play().catch(() => setRefused(true));
  }, [reduceMotion]);

  const root = webAppRoot();
  return (
    <View style={{ alignSelf: 'center', marginTop: 8 }}>
      <video
        ref={video}
        src={new URL(recording.file, root).href}
        poster={new URL(recording.poster, root).href}
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
          height,
          width: (height * recording.width) / recording.height,
          borderRadius: Radius.control,
          border: `1px solid ${theme.separator}`,
          backgroundColor: theme.canvas,
          objectFit: 'cover',
        }}
      />
    </View>
  );
}
