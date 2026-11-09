import type { ButtonHTMLAttributes, ComponentType, ReactNode } from 'react';
import type { StepProps } from '../Step';

export const Step: ComponentType<StepProps>;

declare const ReferenceStepper: ComponentType<{
  children: ReactNode;
  step: number;
  onStepChange: (step: number) => void;
  onFinalStepCompleted: () => void;
  theme: 'dark' | 'light';
  linear: boolean;
  disableStepIndicators?: boolean;
  backButtonText: string;
  nextButtonText: string;
  completeButtonText: string;
  backButtonProps?: ButtonHTMLAttributes<HTMLButtonElement>;
  nextButtonProps?: ButtonHTMLAttributes<HTMLButtonElement>;
  className?: string;
  role?: string;
  'aria-label'?: string;
}>;
export default ReferenceStepper;
