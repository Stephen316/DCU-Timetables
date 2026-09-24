import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt, useLargeText } from '../../ui/components';
import { Space } from '../../ui/theme';

/**
 * A screen's large title, above its first section. Smaller at the accessibility text
 * sizes, where a large title would be cut off rather than wrap.
 */
export function ScreenTitle({ title }: { title: string }) {
  const insets = useSafeAreaInsets();
  const large = useLargeText();
  return (
    <View style={[styles.title, { paddingTop: insets.top + Space.s }]}>
      <Txt type={large ? 'headline' : 'largeTitle'} accessibilityRole="header">{title}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { paddingHorizontal: Space.l + Space.l, paddingBottom: Space.xs },
});
