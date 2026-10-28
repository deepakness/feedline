import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { StyleSheet, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';

import { useSettings } from '@/state/settings';

import type { Theme } from './tokens';
import { paper } from './themes/paper';

export type { Theme } from './tokens';

/** Register new themes here. The first entry is the fallback. */
export const THEMES: Theme[] = [paper];

const ThemeContext = createContext<Theme>(paper);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const themeId = useSettings((s) => s.themeId);
  const theme = useMemo(() => THEMES.find((t) => t.id === themeId) ?? THEMES[0]!, [themeId]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

/** Memoized StyleSheet factory keyed on the active theme. */
type NamedStyles = Record<string, ViewStyle | TextStyle | ImageStyle>;

export function useStyles<T extends NamedStyles>(factory: (theme: Theme) => T): T {
  const theme = useTheme();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => StyleSheet.create(factory(theme)) as T, [theme]);
}
