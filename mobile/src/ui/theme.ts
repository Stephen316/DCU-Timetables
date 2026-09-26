import { createContext, useContext } from 'react';

/**
 * The app's design tokens: colour, space, shape and type, defined once.
 *
 * The palette is deliberately monochrome — five slates of one cool blue-grey, and an
 * accent lifted from the same hue. Colour that isn't slate is news: orange for a
 * cancellation, amber for something due, blue for a test, green for a confirmed date
 * (`tint`). Keeping everything else grey is what lets those four be seen at a glance on a
 * phone held at arm's length on the way to a lecture.
 *
 * Light is Solarized Light, as VS Code draws it: base2 canvas, base3 rows, the theme's
 * #DDD6C1 chrome. Ink steps down from base02 so the faintest tier is still the editor's
 * body text. The accent is violet because Solarized's yellow, blue and green are taken by
 * `tint`. Dark is the iOS app's asset-catalog colours.
 */
export interface Palette {
  scheme: 'light' | 'dark';
  /** Behind everything: the screen itself. */
  canvas: string;
  /** A grouped list's rows. */
  surface: string;
  /** One step up from a surface — sheets, a pressed row, a secondary button. */
  raised: string;
  /** A step darker than `canvas`: free time on the day view. */
  band: string;
  /** Hairlines between rows and on the week grid. */
  separator: string;
  /** The line down the day view. */
  rail: string;
  ink: string;
  inkSecondary: string;
  /** Only on `canvas` or `surface`: too faint for text on `raised`. */
  inkTertiary: string;
  accent: string;
  /** Text on an accent fill. */
  onAccent: string;
  destructive: string;
  /** The colours that carry meaning in the timetable. */
  tint: {
    /** Something to hand in today. */
    due: string;
    /** A quiz or exam sat in that class. */
    test: string;
    /** Reported cancelled (and moved). */
    off: string;
    /** Enough people have vouched for a deadline. */
    confirmed: string;
    /**
     * `off` as a **fill** behind white text, in either theme: white on the light dark-mode
     * shade lands near 2:1, so a filled control keeps the dark shade throughout.
     */
    offFill: string;
  };
  /** Module colours for the calendar blocks: decoration, one per module. */
  modules: string[];
}

export const light: Palette = {
  scheme: 'light',
  canvas: '#EEE8D5',
  surface: '#FDF6E3',
  raised: '#DDD6C1',
  band: '#E5DECA',
  separator: '#D3CBB7',
  rail: '#93A1A1',
  ink: '#073642',
  inkSecondary: '#586E75',
  inkTertiary: '#657B83',
  accent: '#6C71C4',
  onAccent: '#FDF6E3',
  destructive: '#DC322F',
  tint: { due: '#B58900', test: '#268BD2', off: '#CB4B16', confirmed: '#859900', offFill: '#CB4B16' },
  modules: ['#268BD2', '#859900', '#D33682', '#2AA198', '#6C71C4', '#DC322F', '#AC9D57'],
};

export const dark: Palette = {
  scheme: 'dark',
  canvas: '#212129',
  surface: '#323949',
  raised: '#3D3E51',
  band: '#18181E',
  separator: '#40445A',
  rail: '#4C5265',
  ink: '#ECEDF3',
  inkSecondary: '#AEB2C4',
  inkTertiary: '#8A8FA5',
  accent: '#AFB8F2',
  onAccent: '#212129',
  destructive: '#FF6B6B',
  tint: { due: '#FBBF24', test: '#60A5FA', off: '#FB923C', confirmed: '#34D399', offFill: '#C2410C' },
  modules: ['#0A84FF', '#30D158', '#BF5AF2', '#40C8E0', '#5E5CE6', '#FF375F', '#AC8E68'],
};

/** A 4-point scale. Views take their padding from here rather than inventing numbers. */
export const Space = { xxs: 2, xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 } as const;

/**
 * Two radii for two jobs: a block on the week grid has to stay a rectangle at 26pt tall,
 * and a button is a thing your thumb aims at.
 */
export const Radius = { block: 4, control: 8 } as const;

/** The minimum hit area. Visible chrome may be smaller; the tappable frame isn't. */
export const MIN_TARGET = 44;

export const Type = {
  /** The weekday heading the day view. The one loud piece of type in the app. */
  dayName: { fontSize: 34, fontWeight: '800' as const, letterSpacing: 0.4 },
  largeTitle: { fontSize: 30, fontWeight: '700' as const },
  pageTitle: { fontSize: 22, fontWeight: '600' as const },
  title3: { fontSize: 20, fontWeight: '600' as const },
  headline: { fontSize: 17, fontWeight: '600' as const },
  body: { fontSize: 17 },
  callout: { fontSize: 16 },
  subheadline: { fontSize: 15 },
  footnote: { fontSize: 13 },
  caption: { fontSize: 12 },
  caption2: { fontSize: 11 },
  /** Small status lines: "Reported cancelled", "Starts in 20 min". */
  status: { fontSize: 12, fontWeight: '600' as const },
  /** A class's start time on the rail, tabular so times stack into a column. */
  railStart: { fontSize: 20, fontWeight: '600' as const, fontVariant: ['tabular-nums' as const] },
  railEnd: { fontSize: 13, fontVariant: ['tabular-nums' as const] },
};

export const ThemeContext = createContext<Palette>(light);

export function useTheme(): Palette {
  return useContext(ThemeContext);
}

/** Light, dark, or whatever the phone is set to. A device preference, so it survives sign-out. */
export type AppearanceSetting = 'system' | 'light' | 'dark';

export function appearanceLabel(setting: AppearanceSetting): string {
  switch (setting) {
    case 'system': return 'Match phone';
    case 'light': return 'Light';
    case 'dark': return 'Dark';
  }
}

/** A module's colour on the grid, stable for its code (djb2, as the iOS app hashed it). */
export function moduleTint(palette: Palette, key: string): string {
  let hash = 5381;
  for (let i = 0; i < key.length; i++) hash = ((hash * 33) + key.charCodeAt(i)) | 0;
  const count = palette.modules.length;
  return palette.modules[((hash % count) + count) % count];
}

/** `#RRGGBB` at an opacity, for washes behind blocks. */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.min(Math.max(alpha, 0), 1) * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}
