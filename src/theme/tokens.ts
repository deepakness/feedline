import type { TextStyle } from 'react-native';

/**
 * A theme is pure data. Components read everything visual from here, and the
 * article reader generates its CSS from the same values, so adding a theme is
 * a matter of adding one file to `themes/` and registering it in `index.ts`.
 */
export type ThemeColors = {
  bg: string;
  surface: string;
  surfaceSunken: string;
  ink: string;
  inkSecondary: string;
  inkTertiary: string;
  hairline: string;
  accent: string;
  accentSoft: string;
  onAccent: string;
  danger: string;
  success: string;
  scrim: string;
  /** Muted tile colors for feeds without a favicon. */
  monogram: string[];
};

export type TypeRole =
  | 'display'
  | 'title'
  | 'listTitle'
  | 'listTitleCompact'
  | 'body'
  | 'bodyStrong'
  | 'callout'
  | 'meta'
  | 'metaStrong'
  | 'section'
  | 'button';

export type ThemeFonts = {
  serif: string;
  serifStrong: string;
  sans: string;
  sansMedium: string;
  sansStrong: string;
};

export type ReaderTokens = {
  /** CSS font stacks used inside the article WebView. */
  serifStack: string;
  sansStack: string;
  linkColor: string;
  codeBg: string;
  quoteRule: string;
  selection: string;
};

export type Theme = {
  id: string;
  name: string;
  /** Only light themes exist today; this drives the status bar style. */
  scheme: 'light' | 'dark';
  colors: ThemeColors;
  fonts: ThemeFonts;
  type: Record<TypeRole, TextStyle>;
  space: { xxs: number; xs: number; sm: number; md: number; lg: number; xl: number; xxl: number; gutter: number };
  radius: { sm: number; md: number; lg: number; pill: number };
  motion: { fast: number; base: number; slow: number };
  reader: ReaderTokens;
};
