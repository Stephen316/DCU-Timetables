import type { ReactNode } from 'react';

export type SetupButtonProps = {
  title: string;
  onPress: () => void;
  icon?: ReactNode;
  variant?: 'default' | 'outline' | 'ghost';
  disabled?: boolean;
  busy?: boolean;
};
