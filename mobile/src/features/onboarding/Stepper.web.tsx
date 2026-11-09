import type { ButtonHTMLAttributes } from 'react';
import { Button } from './notra/button/components/button';
import { useTheme } from '../../ui/theme';
import type { StepperProps } from './Step';
import ReferenceStepper from './notra/ReferenceStepper';
import './notra/account-setup.css';

export { Step } from './notra/ReferenceStepper';

function FooterButton({ className, 'aria-busy': busy, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const back = className?.includes('stepper__button--back');
  return (
    <Button
      {...props}
      className={`account-setup-action ${back ? 'account-setup-back' : 'account-setup-next'} ${className?.includes('account-setup-next-hidden') ? 'account-setup-next-hidden' : ''}`}
      variant={back ? 'outline' : 'default'}
      loading={busy === true}
      size="lg"
    />
  );
}

export default function Stepper({
  children, step, onStepChange, onFinalStepCompleted,
  backButtonText = 'Back', nextButtonText = 'Continue', showNext = true, nextDisabled, busy,
}: StepperProps) {
  const { scheme } = useTheme();
  return (
    <ReferenceStepper
      role="dialog"
      aria-label="Account setup"
      className={scheme === 'dark' ? 'account-setup-stepper notra-dark' : 'account-setup-stepper'}
      FooterButton={FooterButton}
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
