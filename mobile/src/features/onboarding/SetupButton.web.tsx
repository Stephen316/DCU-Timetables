import { useTheme } from '../../ui/theme';
import type { SetupButtonProps } from './SetupButton.types';
import { Button } from './notra/button/components/button';
import './notra/setup.css';

export function SetupButton({ title, onPress, icon, variant, disabled, busy }: SetupButtonProps) {
  const { scheme } = useTheme();
  return (
    <Button
      type="button"
      aria-label={title}
      className={scheme === 'dark' ? 'notra-setup-button notra-dark' : 'notra-setup-button'}
      variant={variant}
      size="lg"
      disabled={disabled}
      loading={busy}
      onClick={onPress}
    >
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      {title}
    </Button>
  );
}
