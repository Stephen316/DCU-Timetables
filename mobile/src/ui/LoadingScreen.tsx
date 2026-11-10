import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, ImageSourcePropType, StyleSheet, View } from 'react-native';
import { AsciiWake } from './AsciiWake';
import { Txt } from './components';
import { isNewUI } from './newUI';
import { Space, useTheme } from './theme';

// Metro's way to bundle an image.
const icon: ImageSourcePropType = require('../../assets/icon.png');

/** How long before the loading screen says it's still waiting, and on what. */
const SLOW_AFTER_MS = 6_000;

/**
 * What shows while there's nothing to show yet: the app's icon, a spinner, and what it's
 * waiting for. After a few seconds it says it's still trying, so a slow server doesn't
 * look like a frozen app. The web page's own copy of it (public/index.html) shows while the
 * app's code downloads, and looks the same, so the one hands over to the other unseen.
 */
export function LoadingScreen({ caption, slowCaption }: { caption?: string; slowCaption?: string }) {
  const theme = useTheme();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!slowCaption) return;
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [slowCaption]);

  const said = slow && slowCaption ? slowCaption : caption;
  return (
    <View
      style={[styles.fill, { backgroundColor: theme.canvas }]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={said ?? 'Loading'}
      accessibilityLiveRegion="polite"
    >
      <Image source={icon} style={styles.icon} accessibilityIgnoresInvertColors />
      {/* The boot screen (no caption) matches the web page's own spinner; later loads get the wake. */}
      {isNewUI() && caption ? <AsciiWake /> : <ActivityIndicator color={theme.inkSecondary} />}
      {said ? (
        <Txt type="subheadline" color={theme.inkSecondary} style={styles.caption}>{said}</Txt>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: Space.l, padding: Space.xl },
  // The same size and rounding as the web page's copy in public/index.html.
  icon: { width: 88, height: 88, borderRadius: 20 },
  caption: { textAlign: 'center', maxWidth: 300 },
});
