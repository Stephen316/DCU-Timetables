import { Fragment, ReactNode } from 'react';
import ShinyText from './ShinyText';
import { useTheme } from './theme';

/**
 * Where the word sits: on the page's own background, or on a filled violet button, where the
 * grey would be lost and the word is drawn in a softened white instead.
 */
export type PlusTone = 'page' | 'onFill';

/**
 * The word "Plus", wherever the app names it: a band of light sweeping across it, as the
 * supplied Shiny Text settings have it. On the dark theme it's exactly those settings, a pale
 * grey with a white shine; on the light theme the grey is deepened, since the pale one all but
 * vanishes on white.
 */
export function PlusWord({ word = 'Plus', tone = 'page' }: { word?: string; tone?: PlusTone }) {
  const theme = useTheme();
  const color = tone === 'onFill' ? 'rgba(255, 255, 255, 0.72)' : theme.scheme === 'dark' ? '#b5b5b5' : '#8a8a8a';
  return (
    <ShinyText
      text={word}
      color={color}
      shineColor="#ffffff"
      speed={2}
      shineWidth={40}
      softness={0.8}
      trigger="loop"
      delay={0}
      angle={120}
      bands={1}
      glow={0}
      direction="left"
      easing="smooth"
      yoyo={false}
      followPointer={false}
      pauseOnHover={false}
      disabled={false}
    />
  );
}

/**
 * A line of text with every "Plus" in it shining and the rest left as it is: "Get Plus",
 * "Continue with Plus". Only the whole word, in either case; "plus" inside another word stays.
 */
export function withShinyPlus(text: string, tone: PlusTone = 'page'): ReactNode {
  const parts = text.split(/\b(plus)\b/i);
  if (parts.length === 1) return text;
  return parts.map((part, i) => (i % 2 === 1 ? <PlusWord key={i} word={part} tone={tone} /> : <Fragment key={i}>{part}</Fragment>));
}
