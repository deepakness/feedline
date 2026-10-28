import { useEffect } from 'react';
import { Switch as RNSwitch, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/theme';

import { Pressable } from './Pressable';
import { Text } from './Text';

/** Sticky day divider in the timeline. */
/** Fixed so the pull-to-refresh spinner can start just below a pinned day header. */
export const DAY_HEADER_HEIGHT = 40;

export function DayHeader({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: theme.colors.bg,
        height: DAY_HEADER_HEIGHT,
        paddingHorizontal: theme.space.gutter,
        paddingTop: 18,
        paddingBottom: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
      }}
      accessibilityRole="header"
    >
      <Text variant="section" tone="tertiary">
        {label}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.hairline }} />
    </View>
  );
}

export function Divider({ inset = 0, style }: { inset?: number; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return <View style={[{ height: 1, backgroundColor: theme.colors.hairline, marginLeft: inset }, style]} />;
}

/** Thin bar under the header: determinate while feeds load, then a gentle shimmer while downloading. */
export function ProgressBar({ progress, active }: { progress: number | null; active: boolean }) {
  const theme = useTheme();
  const shimmer = useSharedValue(0);
  const width = useSharedValue(0);

  useEffect(() => {
    if (progress == null && active) {
      shimmer.set(0);
      shimmer.set(withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }), -1, false));
    } else cancelAnimation(shimmer);
  }, [progress, active, shimmer]);

  useEffect(() => {
    width.set(withTiming(progress ?? 0, { duration: 260 }));
  }, [progress, width]);

  const barStyle = useAnimatedStyle(() =>
    progress == null
      ? { left: `${shimmer.value * 100 - 30}%`, width: '30%' }
      : { left: '0%', width: `${Math.max(4, width.value * 100)}%` },
  );
  const containerStyle = useAnimatedStyle(() => ({ opacity: withTiming(active ? 1 : 0, { duration: 240 }) }));

  return (
    <Animated.View style={[{ height: 2, overflow: 'hidden', backgroundColor: theme.colors.accentSoft }, containerStyle]}>
      <Animated.View style={[{ position: 'absolute', top: 0, bottom: 0, backgroundColor: theme.colors.accent }, barStyle]} />
    </Animated.View>
  );
}

export function SectionTitle({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <Text variant="section" tone="tertiary" style={{ paddingHorizontal: theme.space.gutter, paddingTop: 28, paddingBottom: 8 }}>
      {children}
    </Text>
  );
}

type RowProps = {
  label: string;
  detail?: string;
  value?: string;
  onPress?: () => void;
  right?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
};

/** Settings-style row: label (+ detail) on the left, value or control on the right. */
export function Row({ label, detail, value, onPress, right, danger, disabled }: RowProps) {
  const theme = useTheme();
  const body = (
    <View
      style={{
        minHeight: 56,
        paddingHorizontal: theme.space.gutter,
        paddingVertical: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text variant="body" tone={danger ? 'danger' : 'ink'}>
          {label}
        </Text>
        {detail ? (
          <Text variant="meta" tone="tertiary" style={{ marginTop: 2 }}>
            {detail}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="callout" tone="secondary">
          {value}
        </Text>
      ) : null}
      {right}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} disabled={disabled} pressScale={1} accessibilityRole="button" accessibilityLabel={label}>
      {body}
    </Pressable>
  );
}

export function Switch({ value, onValueChange, label }: { value: boolean; onValueChange: (v: boolean) => void; label: string }) {
  const theme = useTheme();
  return (
    <RNSwitch
      value={value}
      onValueChange={onValueChange}
      accessibilityLabel={label}
      trackColor={{ false: theme.colors.hairline, true: theme.colors.accent }}
      thumbColor={theme.colors.surface}
    />
  );
}

/** Compact segmented control with an ink-filled selection. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: theme.colors.surfaceSunken,
        borderRadius: theme.radius.md,
        padding: 3,
        marginHorizontal: theme.space.gutter,
        marginBottom: 8,
      }}
      accessibilityRole="radiogroup"
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => onChange(o.value)}
            pressScale={1}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            style={{
              flex: 1,
              height: 40,
              borderRadius: theme.radius.sm + 1,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: selected ? theme.colors.surface : 'transparent',
              borderWidth: selected ? 1 : 0,
              borderColor: theme.colors.hairline,
            }}
          >
            <Text variant={selected ? 'metaStrong' : 'meta'} tone={selected ? 'ink' : 'secondary'} style={{ fontSize: 13 }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
