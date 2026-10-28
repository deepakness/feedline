import type { Theme, ThemeFonts } from '../tokens';

const fonts: ThemeFonts = {
  serif: 'Newsreader_500Medium',
  serifStrong: 'Newsreader_600SemiBold',
  sans: 'Inter_400Regular',
  sansMedium: 'Inter_500Medium',
  sansStrong: 'Inter_600SemiBold',
};

/** Warm paper editorial: off-white stock, near-black ink, one terracotta accent. */
export const paper: Theme = {
  id: 'paper',
  name: 'Paper',
  scheme: 'light',
  colors: {
    bg: '#FAF7F2',
    surface: '#FFFFFF',
    surfaceSunken: '#F2EDE4',
    ink: '#1D1B18',
    inkSecondary: '#5C564E',
    inkTertiary: '#7A7268',
    hairline: '#E6DFD3',
    accent: '#B4532A',
    accentSoft: '#F3E3D9',
    onAccent: '#FFFFFF',
    danger: '#B3261E',
    success: '#3C6E47',
    scrim: 'rgba(29, 27, 24, 0.32)',
    monogram: ['#E9DCCB', '#DCE3D5', '#E5D6D6', '#D8DEE6', '#E8E0C9', '#DDD5E4'],
  },
  fonts,
  type: {
    display: { fontFamily: fonts.serifStrong, fontSize: 30, lineHeight: 36, letterSpacing: -0.4 },
    title: { fontFamily: fonts.serifStrong, fontSize: 22, lineHeight: 28, letterSpacing: -0.2 },
    listTitle: { fontFamily: fonts.serif, fontSize: 18, lineHeight: 24, letterSpacing: -0.1 },
    listTitleCompact: { fontFamily: fonts.serif, fontSize: 16, lineHeight: 21 },
    body: { fontFamily: fonts.sans, fontSize: 15, lineHeight: 22 },
    bodyStrong: { fontFamily: fonts.sansStrong, fontSize: 15, lineHeight: 22 },
    callout: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 20 },
    meta: { fontFamily: fonts.sansMedium, fontSize: 12, lineHeight: 16, letterSpacing: 0.2 },
    metaStrong: { fontFamily: fonts.sansStrong, fontSize: 12, lineHeight: 16, letterSpacing: 0.2 },
    section: {
      fontFamily: fonts.sansStrong,
      fontSize: 11,
      lineHeight: 14,
      letterSpacing: 0.9,
      textTransform: 'uppercase',
    },
    button: { fontFamily: fonts.sansStrong, fontSize: 15, lineHeight: 20 },
  },
  space: { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, gutter: 20 },
  radius: { sm: 8, md: 12, lg: 16, pill: 999 },
  motion: { fast: 140, base: 200, slow: 280 },
  reader: {
    serifStack: "'Newsreader', Georgia, serif",
    sansStack: "'Inter', system-ui, sans-serif",
    linkColor: '#B4532A',
    codeBg: '#F2EDE4',
    quoteRule: '#D9CFBF',
    selection: 'rgba(180, 83, 42, 0.18)',
  },
};
