import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Txt } from '../../ui/components';
import { SetupButton } from './SetupButton';
import { Space, useTheme } from '../../ui/theme';

import type { StepperProps } from './Step';
export { Step } from './Step';

/** The supplied React Bits stepper's horizontal numbered track, adapted for React Native. */
export default function Stepper({
  children, step, onStepChange, onFinalStepCompleted,
  backButtonText = 'Back', nextButtonText = 'Continue', showNext = true, nextDisabled, busy,
}: StepperProps) {
  const theme = useTheme();
  return (
    <View style={[styles.frame, { backgroundColor: theme.raised, borderColor: theme.separator }]}>
      <View style={[styles.track, { backgroundColor: theme.canvas }]}>
        {children.map(({ props: { title } }, index) => {
          const number = index + 1;
          const active = number === step;
          const complete = number < step;
          const ink = active ? theme.ink : theme.inkSecondary;
          return (
            <Pressable
              key={title}
              accessibilityRole="button"
              accessibilityLabel={`Step ${number} of ${children.length}, ${title}${complete ? ', completed' : ''}`}
              accessibilityState={{ selected: active, disabled: !complete || !!busy }}
              disabled={!complete || busy}
              onPress={() => onStepChange(number)}
              style={[styles.segment, active && { backgroundColor: theme.raised, borderColor: theme.separator }]}
            >
              <View style={[styles.badge, { borderColor: active ? ink : theme.separator }, complete && { backgroundColor: theme.ink }]}>
                {complete ? <Icon name="check" size={13} color={theme.canvas} /> : <Txt type="caption" color={ink}>{number}</Txt>}
              </View>
              <Txt type="caption" color={ink}>{title}</Txt>
            </Pressable>
          );
        })}
      </View>
      {children[step - 1]}
      <View style={styles.footer}>
        {step > 1 ? <SetupButton variant="outline" title={backButtonText} disabled={busy} onPress={() => onStepChange(step - 1)} /> : null}
        {showNext ? (
          <View style={styles.next}>
            <SetupButton
              title={nextButtonText}
              disabled={nextDisabled}
              busy={busy}
              onPress={() => step === children.length ? onFinalStepCompleted() : onStepChange(step + 1)}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%', maxWidth: 440, alignSelf: 'center', borderWidth: 1, borderRadius: 16, padding: Space.s },
  track: { flexDirection: 'row', gap: Space.xs, padding: Space.xs, borderRadius: 10 },
  segment: { flex: 1, minHeight: 44, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: Space.xs, padding: Space.xs, borderRadius: 8, borderWidth: 1, borderColor: 'transparent' },
  badge: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  footer: { flexDirection: 'row', gap: Space.s, paddingHorizontal: Space.s, paddingBottom: Space.s },
  next: { flex: 1 },
});
