import type { ReactNode } from 'react';

/** React Bits' Shiny Text settings, as the supplied component takes them. */
export type ShinyTextProps = {
  text?: string;
  children?: ReactNode;
  color?: string;
  shineColor?: string;
  /** Seconds a sweep takes. */
  speed?: number;
  /** Seconds between sweeps. */
  delay?: number;
  angle?: number;
  /** The band's width, as a percentage of the text's. */
  shineWidth?: number;
  softness?: number;
  bands?: number;
  glow?: number;
  direction?: 'left' | 'right';
  easing?: 'linear' | 'smooth' | 'snappy';
  trigger?: 'loop' | 'hover' | 'view';
  yoyo?: boolean;
  followPointer?: boolean;
  pauseOnHover?: boolean;
  disabled?: boolean;
};
