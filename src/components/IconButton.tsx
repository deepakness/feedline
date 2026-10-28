import type { LucideIcon } from 'lucide-react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { useTheme } from '@/theme';

import { Pressable } from './Pressable';

type Props = {
  icon: LucideIcon;
  onPress?: () => void;
  label: string;
  color?: string;
  size?: number;
  filled?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function IconButton({ icon: Icon, onPress, label, color, size = 22, filled, disabled, style }: Props) {
  const theme = useTheme();
  const tint = color ?? theme.colors.ink;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      pressScale={0.9}
      style={[{ width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21 }, style]}
    >
      <Icon size={size} color={tint} strokeWidth={1.75} fill={filled ? tint : 'transparent'} />
    </Pressable>
  );
}
