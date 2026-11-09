import { Tick02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { SetupPlanProps, StudentNumberFieldProps } from './SetupFields.types';
import { Card, CardDescription, CardHeader, CardTitle } from './notra/shadcn-card';
import { Input } from './notra/shadcn-input';

export function SetupPlan({ title, description, selected }: SetupPlanProps) {
  return (
    <Card className="account-setup-plan" data-selected={selected || undefined} size="sm">
      <CardHeader>
        <CardTitle>
          {title}
          {selected ? <span className="account-setup-selected"><HugeiconsIcon icon={Tick02Icon} size={14} /> Selected</span> : null}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  );
}

export function StudentNumberField({ value, disabled, onChange, onSubmit }: StudentNumberFieldProps) {
  return (
    <Input
      className="account-setup-input"
      aria-label="Student number"
      autoCapitalize="characters"
      autoComplete="off"
      spellCheck={false}
      disabled={disabled}
      value={value}
      placeholder="A00000000"
      onChange={(event) => onChange(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) onSubmit();
      }}
    />
  );
}
