import { ReactElement, ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, PrimaryButton, SecondaryButton, Txt } from '../../ui/components';
import { Space, useTheme } from '../../ui/theme';

type StepProps = { title: string; children: ReactNode };

export function Step({ children }: StepProps) {
  return <View style={styles.content}>{children}</View>;
}

/** The supplied React Bits stepper's horizontal numbered track, adapted for React Native. */
export default function Stepper({
  children, step, onStepChange, onFinalStepCompleted,
  backButtonText = 'Back', nextButtonText = 'Continue', showNext = true, nextDisabled, busy,
}: {
  children: ReactElement<StepProps>[];
  step: number;
  onStepChange: (step: number) => void;
  onFinalStepCompleted: () => void;
  backButtonText?: string;
  nextButtonText?: string;
  showNext?: boolean;
  nextDisabled?: boolean;
  busy?: boolean;
}) {
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
        {step > 1 ? <SecondaryButton title={backButtonText} disabled={busy} onPress={() => onStepChange(step - 1)} /> : null}
        {showNext ? (
          <View style={styles.next}>
            <PrimaryButton
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
  content: { gap: Space.m, padding: Space.l },
  footer: { flexDirection: 'row', gap: Space.s, paddingHorizontal: Space.s, paddingBottom: Space.s },
  next: { flex: 1 },
});
