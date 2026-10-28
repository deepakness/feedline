import { Pressable as RNPressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

type Props = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  /** Scale while pressed; 1 disables the effect. */
  pressScale?: number;
  pressOpacity?: number;
};

/**
 * Quiet press feedback: a slight dip in opacity and scale instead of a ripple.
 * Applied instantly through the native pressed state, so lists of these carry no
 * per-item animation state.
 */
export function Pressable({ pressScale = 0.98, pressOpacity = 0.65, style, disabled, ...rest }: Props) {
  return (
    <RNPressable
      disabled={disabled}
      style={({ pressed }) => [
        style,
        pressed && { opacity: pressOpacity, transform: pressScale === 1 ? undefined : [{ scale: pressScale }] },
        disabled ? { opacity: 0.4 } : null,
      ]}
      {...rest}
    />
  );
}
