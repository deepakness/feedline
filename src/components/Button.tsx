import type { LucideIcon } from 'lucide-react-native';
import { ActivityIndicator, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme';

import { Pressable } from './Pressable';
import { Text } from './Text';

type Props = {
  label: string;
  onPress?: () => void;
  kind?: 'primary' | 'secondary' | 'plain' | 'danger';
  icon?: LucideIcon;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Button({ label, onPress, kind = 'primary', icon: Icon, loading, disabled, style }: Props) {
  const theme = useTheme();
  const c = theme.colors;
  const palette = {
    primary: { bg: c.ink, fg: c.bg, border: c.ink },
    secondary: { bg: c.surface, fg: c.ink, border: c.hairline },
    plain: { bg: 'transparent', fg: c.accent, border: 'transparent' },
    danger: { bg: c.surface, fg: c.danger, border: c.hairline },
  }[kind];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        {
          height: 50,
          paddingHorizontal: 20,
          borderRadius: theme.radius.md,
          backgroundColor: palette.bg,
          borderWidth: 1,
          borderColor: palette.border,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <>
          {Icon ? <Icon size={18} color={palette.fg} strokeWidth={2} /> : null}
          <Text variant="button" style={{ color: palette.fg }}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}
