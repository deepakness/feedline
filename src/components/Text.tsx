import { Text as RNText, type TextProps } from 'react-native';

import { useTheme } from '@/theme';
import type { TypeRole } from '@/theme/tokens';

type Tone = 'ink' | 'secondary' | 'tertiary' | 'accent' | 'danger' | 'onAccent';

export type AppTextProps = TextProps & { variant?: TypeRole; tone?: Tone };

export function Text({ variant = 'body', tone = 'ink', style, ...rest }: AppTextProps) {
  const theme = useTheme();
  const color = {
    ink: theme.colors.ink,
    secondary: theme.colors.inkSecondary,
    tertiary: theme.colors.inkTertiary,
    accent: theme.colors.accent,
    danger: theme.colors.danger,
    onAccent: theme.colors.onAccent,
  }[tone];
  return <RNText maxFontSizeMultiplier={1.6} {...rest} style={[theme.type[variant], { color }, style]} />;
}
