import { Pressable, StyleSheet } from 'react-native';
import { Txt } from '../../ui/components';
import { withShinyPlus } from '../../ui/PlusWord';
import { Space, useTheme } from '../../ui/theme';

import type { SetupButtonProps } from './SetupButton.types';

export function SetupButton({ title, onPress, icon, variant = 'default', disabled, busy }: SetupButtonProps) {
  const theme = useTheme();
  const primary = variant === 'default';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: disabled || busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={[styles.button, {
        backgroundColor: primary ? theme.accent : variant === 'outline' ? theme.raised : 'transparent',
        borderColor: variant === 'outline' ? theme.separator : 'transparent',
        opacity: disabled || busy ? 0.5 : 1,
      }]}
    >
      {icon}
      <Txt color={primary ? theme.onAccent : theme.ink}>{withShinyPlus(title, primary ? 'onFill' : 'page')}</Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 44, borderWidth: 1, borderRadius: 8, paddingHorizontal: Space.m, flexDirection: 'row', gap: Space.s, alignItems: 'center', justifyContent: 'center' },
});
