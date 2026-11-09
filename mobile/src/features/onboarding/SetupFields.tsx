import { StyleSheet, TextInput, View } from 'react-native';
import { Icon, Txt } from '../../ui/components';
import { Space, useTheme } from '../../ui/theme';

import type { SetupPlanProps, StudentNumberFieldProps } from './SetupFields.types';

export function SetupPlan({ title, description, selected }: SetupPlanProps) {
  const theme = useTheme();
  return (
    <View style={[styles.plan, { backgroundColor: theme.canvas, borderColor: selected ? theme.accent : theme.separator }]}>
      <View style={styles.planText}>
        <Txt type="headline">{selected ? `${title} · Selected` : title}</Txt>
        <Txt color={theme.inkSecondary}>{description}</Txt>
      </View>
      {selected ? <Icon name="check" color={theme.accent} /> : null}
    </View>
  );
}

export function StudentNumberField({ value, disabled, onChange, onSubmit }: StudentNumberFieldProps) {
  const theme = useTheme();
  return (
    <TextInput
      accessibilityLabel="Student number"
      autoCapitalize="characters"
      autoCorrect={false}
      editable={!disabled}
      onChangeText={onChange}
      onSubmitEditing={onSubmit}
      placeholder="A00000000"
      placeholderTextColor={theme.inkTertiary}
      returnKeyType="done"
      style={[styles.input, { color: theme.ink, borderColor: theme.separator, backgroundColor: theme.canvas }]}
      value={value}
    />
  );
}

const styles = StyleSheet.create({
  plan: { flexDirection: 'row', alignItems: 'center', gap: Space.m, padding: Space.m, borderWidth: 1, borderRadius: 8 },
  planText: { flex: 1, gap: Space.xs },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 8, paddingHorizontal: Space.m, fontSize: 17 },
});
