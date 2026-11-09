import type { ReactElement, ReactNode } from 'react';
import { View } from 'react-native';
import { Space } from '../../ui/theme';

export type StepProps = { title: string; children: ReactNode };

export function Step({ children }: StepProps) {
  return <View style={{ gap: Space.m, padding: Space.l }}>{children}</View>;
}

export type StepperProps = {
  children: ReactElement<StepProps>[];
  step: number;
  onStepChange: (step: number) => void;
  onFinalStepCompleted: () => void;
  backButtonText?: string;
  nextButtonText?: string;
  showNext?: boolean;
  nextDisabled?: boolean;
  busy?: boolean;
};
