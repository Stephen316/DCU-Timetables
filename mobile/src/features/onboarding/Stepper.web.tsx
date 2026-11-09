import { useTheme } from '../../ui/theme';
import type { StepperProps } from './Step';
import { SetupButton } from './SetupButton';
import { IconTabs, IconTabsContent, IconTabsList, IconTabsTrigger } from './notra/icon-tabs/components/icon-tabs';

export { Step } from './Step';

export default function Stepper({
  children, step, onStepChange, onFinalStepCompleted,
  backButtonText = 'Back', nextButtonText = 'Continue', showNext = true, nextDisabled, busy,
}: StepperProps) {
  const { scheme } = useTheme();
  const value = String(step);
  return (
    <div className={scheme === 'dark' ? 'notra-setup notra-dark' : 'notra-setup'} role="dialog" aria-label="Account setup">
      <IconTabs value={value} onValueChange={(next) => onStepChange(Number(next))}>
        <IconTabsList aria-label="Account setup steps" value={value}>
          {children.map(({ props: { title } }, index) => {
            const number = index + 1;
            return (
              <IconTabsTrigger
                key={title}
                value={String(number)}
                disabled={busy || number > step}
                icon={<span className="notra-setup-number">{number}</span>}
                aria-label={`Step ${number} of ${children.length}, ${title}`}
              >
                {title}
              </IconTabsTrigger>
            );
          })}
        </IconTabsList>
        {children.map((child, index) => (
          <IconTabsContent key={child.props.title} value={String(index + 1)}>
            {child}
          </IconTabsContent>
        ))}
      </IconTabs>
      <div className="notra-setup-footer">
        {step > 1 ? <SetupButton variant="outline" title={backButtonText} disabled={busy} onPress={() => onStepChange(step - 1)} /> : null}
        {showNext ? (
          <SetupButton
            title={nextButtonText}
            disabled={nextDisabled}
            busy={busy}
            onPress={() => step === children.length ? onFinalStepCompleted() : onStepChange(step + 1)}
          />
        ) : null}
      </div>
    </div>
  );
}
