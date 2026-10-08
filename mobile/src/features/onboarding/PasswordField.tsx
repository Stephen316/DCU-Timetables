import { Pressable, StyleSheet, TextInput, TextInputProps, View } from 'react-native';
import { Icon } from '../../ui/components';
import { useTheme } from '../../ui/theme';

/**
 * A password input with a button to show what's been typed. The eye shows the state it
 * switches to, as iOS's own password fields do.
 *
 * Shared by sign-in and the reset a recovery link opens, so the two look the same.
 */
export function PasswordField({
  placeholder, revealed, onToggleReveal, ...input
}: Pick<TextInputProps, 'value' | 'onChangeText' | 'autoComplete' | 'returnKeyType' | 'onSubmitEditing'> & {
  placeholder: string;
  revealed: boolean;
  onToggleReveal: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.line}>
      <TextInput
        {...input}
        placeholder={placeholder}
        placeholderTextColor={theme.inkTertiary}
        secureTextEntry={!revealed}
        textContentType="password"
        // Shown in plain text, the keyboard would otherwise capitalise and correct it.
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        style={[styles.input, { color: theme.ink }]}
        accessibilityLabel={placeholder}
      />
      <Pressable
        onPress={onToggleReveal}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
        style={styles.reveal}
      >
        <Icon name={revealed ? 'hide' : 'show'} size={22} color={theme.inkSecondary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center' },
  input: { flex: 1, fontSize: 17, minHeight: 36 },
  reveal: { minWidth: 44, minHeight: 36, alignItems: 'flex-end', justifyContent: 'center' },
});
