import { useTheme } from '../../ui/theme';
import type { StepperProps } from './Step';
import ReferenceStepper from './notra/ReferenceStepper';
import './notra/account-setup.css';

export { Step } from './notra/ReferenceStepper';

export default function Stepper({
  children, step, onStepChange, onFinalStepCompleted,
  backButtonText = 'Back', nextButtonText = 'Continue', showNext = true, nextDisabled, busy,
}: StepperProps) {
  const { scheme } = useTheme();
  return (
    <ReferenceStepper
      role="dialog"
      aria-label="Account setup"
      className="account-setup-stepper"
      step={step}
      onStepChange={(next) => {
        if (!busy && (next < step || (next === step + 1 && showNext && !nextDisabled))) onStepChange(next);
      }}
      onFinalStepCompleted={onFinalStepCompleted}
      theme={scheme}
      linear
      disableStepIndicators={busy}
      backButtonText={backButtonText}
      nextButtonText={nextButtonText}
      completeButtonText={nextButtonText}
      backButtonProps={{ disabled: busy }}
      nextButtonProps={{
        disabled: busy || nextDisabled || !showNext,
        className: showNext ? undefined : 'account-setup-next-hidden',
        'aria-busy': busy,
      }}
    >
      {children}
    </ReferenceStepper>
  );
}
