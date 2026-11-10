import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Icon, Txt } from '../../ui/components';
import { withShinyPlus } from '../../ui/PlusWord';
import { Space, useTheme } from '../../ui/theme';

import type { SetupPlanProps, StudentNumberFieldProps } from './SetupFields.types';

export function SetupPlan({ title, description, selected, onExplore }: SetupPlanProps) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole={onExplore ? 'button' : undefined} accessibilityLabel={onExplore ? 'Explore Plus' : undefined} disabled={!onExplore} onPress={onExplore} style={[styles.plan, { backgroundColor: theme.canvas, borderColor: selected ? theme.accent : theme.separator }]}>
      <View style={styles.planText}>
        <View style={styles.planHeading}>
          <Txt type="headline">{withShinyPlus(title)}{selected ? ' · Selected' : ''}</Txt>
          {onExplore ? <Txt type="subheadline" color={theme.inkSecondary}>› Explore {withShinyPlus('plus')}</Txt> : null}
        </View>
        <Txt color={theme.inkSecondary}>{description}</Txt>
      </View>
      {selected ? <Icon name="check" color={theme.accent} /> : null}
    </Pressable>
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
  planHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Space.s },
  plan: { flexDirection: 'row', alignItems: 'center', gap: Space.m, padding: Space.m, borderWidth: 1, borderRadius: 8 },
  planText: { flex: 1, gap: Space.xs },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 8, paddingHorizontal: Space.m, fontSize: 17, textAlign: 'center', fontVariant: ['tabular-nums'], letterSpacing: 1 },
});
