import { createContext, useContext } from 'react';
import { Platform, StyleSheet, ViewStyle } from 'react-native';

/**
 * The app's design tokens: colour, space, shape and type, defined once.
 *
 * The look is Notra's (usenotra.com): Notra's violet on near-white or near-black neutrals,
 * white cards with a soft shadow (a hairline border instead in the dark), 10pt controls and
 * pill-shaped choices. Classes are drawn solid in their module's colour under white type.
 *
 * Meaning keeps colours of its own (`tint`): orange for a cancellation, amber for something
 * due, blue for a test, green for a confirmed or completed date. Nothing decorative uses
 * those four, so they can be seen at a glance on the way to a lecture.
 *
 * Light is a violet-tinted white; dark is #131316 with #1C1C21 cards. The module colours are
 * the same in both, so a module is one colour whichever way the phone is set.
 */
export interface Palette {
  scheme: 'light' | 'dark';
  /** Behind everything: the screen itself. */
  canvas: string;
  /** A grouped list's rows. */
  surface: string;
  /** One step up from a surface — sheets, a pressed row, a secondary button. */
  raised: string;
  /** Free time on the day view: a quiet fill between classes. */
  band: string;
  /** Hairlines between rows, and a card's border in the dark. */
  separator: string;
  /** The hour lines on the timetable grids: fainter than a row's hairline. */
  gridLine: string;
  /** An unticked circle, a sheet's grabber: a mark that should read as empty. */
  rail: string;
  ink: string;
  inkSecondary: string;
  /** Only on `canvas` or `surface`: too faint for text on `raised`. */
  inkTertiary: string;
  accent: string;
  /** Text on an accent fill. */
  onAccent: string;
  destructive: string;
  /** The line on the week grid at the current time, red as Calendar draws it. */
  now: string;
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
    /** A deadline that counts towards the grade: a bright outline meant to catch the eye. */
    graded: string;
    /**
     * `off` as a **fill** behind white text, in either theme: white on the light dark-mode
     * shade lands near 2:1, so a filled control keeps the dark shade throughout.
     */
    offFill: string;
    /** Online classes: drawn as faint lines across the class, never as a fill. */
    online: string;
  };
  /** Module colours for the calendar blocks: decoration, one per module. */
  modules: string[];
}

/**
 * Module colours, from the timetable design Stephen picked: soft blue, green, purple, teal and
 * indigo, with a rose and an amber in the same key for the sixth and seventh module.
 */
const MODULES = ['#406AC3', '#6AA75E', '#8953BA', '#6AA0B4', '#4D4CB0', '#C14D6B', '#D2853A'];

export const light: Palette = {
  scheme: 'light',
  canvas: '#F6F5FB',
  surface: '#FFFFFF',
  raised: '#EFEDF9',
  band: '#F1EFF8',
  separator: '#E7E4F2',
  gridLine: '#EEECF6',
  rail: '#C4C0DA',
  ink: '#171717',
  inkSecondary: '#55526B',
  inkTertiary: '#6B6885',
  accent: '#7C3AED',
  onAccent: '#FFFFFF',
  destructive: '#E11D48',
  now: '#F43F5E',
  tint: { due: '#B45309', test: '#2563EB', off: '#EA580C', confirmed: '#059669', graded: '#DB2777', offFill: '#C2410C', online: '#16A34A' },
  modules: MODULES,
};

export const dark: Palette = {
  scheme: 'dark',
  canvas: '#131316',
  surface: '#1C1C21',
  raised: '#26252D',
  band: '#26252E',
  separator: '#2C2B34',
  gridLine: '#24232B',
  rail: '#4A4858',
  ink: '#FAFAFA',
  inkSecondary: '#B4B1C7',
  inkTertiary: '#8A879F',
  accent: '#8B5CF6',
  onAccent: '#FFFFFF',
  destructive: '#FF6B81',
  now: '#FF4D6A',
  tint: { due: '#FBBF24', test: '#60A5FA', off: '#FB923C', confirmed: '#34D399', graded: '#F472B6', offFill: '#C2410C', online: '#4ADE80' },
  modules: MODULES,
};

/**
 * How a card sits on the canvas, as Notra draws its cards: a soft two-layer shadow on light,
 * and on dark — where a shadow can't be seen — a hairline border with a faint top highlight.
 * `float` is for what hovers over the page: the tab bar, a menu.
 */
export function elevation(p: Palette, level: 'card' | 'float' = 'card'): ViewStyle {
  if (p.scheme === 'dark') {
    return {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.separator,
      boxShadow: level === 'float' ? '0 10px 30px rgba(0, 0, 0, 0.5)' : 'inset 0 1px 0 rgba(255, 255, 255, 0.04)',
    };
  }
  return {
    boxShadow: level === 'float'
      ? '0 10px 30px -8px rgba(40, 28, 90, 0.22), 0 2px 6px rgba(23, 23, 28, 0.06)'
      : '0 1px 2px rgba(23, 23, 28, 0.06), 0 2px 8px -2px rgba(23, 23, 28, 0.08)',
  };
}

/** A 4-point scale. Views take their padding from here rather than inventing numbers. */
export const Space = { xxs: 2, xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 } as const;

/**
 * A block on the week grid has to stay a rectangle at 26pt tall, and a button is a thing
 * your thumb aims at. Dialogs and panels are built from those and the padding inside them,
 * so their corners curve round the same centre as what's in them (see `concentric`).
 */
const CONTROL = 10;
const CARD = 16;

/**
 * How far a card's contents sit in from its edges: far enough that a line of text or a chip
 * clears the corner's curve rather than running into it. On the 4-point scale.
 */
export const CardInset = { x: 20, y: 14 } as const;

export const Radius = {
  block: 8,
  control: CONTROL,
  /**
   * A grouped card. Kept tighter than its controls plus `CardInset.x` would make it — that
   * curve read as too round — so what's inside keeps its own radius rather than following it.
   */
  card: CARD,
  /** A dialog or a tray on a square screen, its buttons `Space.xl` in. */
  dialog: CONTROL + Space.xl,
  /** A sheet in a desktop window, its cards `Space.l` in. */
  panel: CARD + Space.l,
} as const;

/**
 * Corner concentricity: a rounded shape inside another, `inset` in from its edge, curves
 * around the same centre when its radius is the outer one's less the inset. Below zero the
 * two can't share a centre — the gap is wider than the curve — and the inner shape keeps its
 * own radius instead.
 */
export function concentric(outer: number, inset: number, fallback: number = Radius.control): number {
  const r = outer - inset;
  return r > 0 ? r : fallback;
}

/**
 * The radius of the screen's own corners, for what sits in them: a Face ID iPhone's display
 * is rounded, a desktop window's content and an older phone's aren't. Neither React Native
 * nor the browser can ask the device, so a phone with a home-indicator inset gets the
 * commonest figure — iPhone 12 to 15, 47pt; the Pro Max and 16 Pro run larger, which leaves
 * an inner curve a touch flatter than its frame rather than crossing it.
 */
export function screenCorner(bottomInset: number): number {
  return bottomInset >= 20 ? 47 : 0;
}

/**
 * The same figure for the web build on a Home Screen, which `screenCorner` never sees: without
 * `viewport-fit=cover` the page reports no bottom inset, though the phone is just as round.
 * A Face ID iPhone is the one at least 812pt tall; Safari's own toolbar sits between the page
 * and the corner, so it gets nothing.
 */
export function homeScreenCorner(): number {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return 0;
  const homeScreen = (navigator as { standalone?: boolean }).standalone === true;
  const faceID = /\biPhone\b/.test(navigator.userAgent) && Math.max(screen.width, screen.height) >= 812;
  return homeScreen && faceID ? 47 : 0;
}

/** The minimum hit area. Visible chrome may be smaller; the tappable frame isn't. */
export const MIN_TARGET = 44;

/**
 * A desktop window (the Mac app, or a browser) is far wider than the phone the screens were
 * drawn for. Past `wide`, sheets and short choices float as panels; lists and forms keep to
 * `readable`, the width at which a row's label and its value still read as one line.
 */
export const Desktop = { wide: 760, readable: 680, panel: 620, dialog: 440 } as const;

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
