import { Text } from 'react-native';

import type { ShinyTextProps } from './ShinyText.types';

/**
 * The phone app's Shiny Text. React Native can't paint a gradient through the letters of a
 * line of text, so here the words take the effect's base colour and don't sweep; the website,
 * the one students have, draws the shine (`ShinyText.web.tsx`).
 */
export default function ShinyText({ text, children, color = '#b5b5b5' }: ShinyTextProps) {
  return <Text style={{ color }}>{children ?? text}</Text>;
}
