import { useEffect, useState } from 'react';
import { Keyboard, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

import { useTheme } from '@/theme';

import { Pressable } from './Pressable';
import { Text } from './Text';

type ToastData = {
  id: number;
  message: string;
  action?: { label: string; onPress: () => void };
  duration: number;
};

const useToastStore = create<{ current: ToastData | null; lift: number }>(() => ({ current: null, lift: 0 }));
let seq = 0;

/** Shows a brief message at the bottom of the screen, optionally with one action. */
export function showToast(message: string, opts: { action?: ToastData['action']; duration?: number } = {}) {
  useToastStore.setState({
    current: { id: ++seq, message, action: opts.action, duration: opts.duration ?? (opts.action ? 5000 : 2600) },
  });
}

/**
 * Raises toasts above a screen's own bottom controls (the reader toolbar, a
 * pinned button) while that screen is mounted.
 */
export function useToastLift(px: number) {
  useEffect(() => {
    useToastStore.setState({ lift: px });
    return () => useToastStore.setState({ lift: 0 });
  }, [px]);
}

export function ToastHost() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToastStore((s) => s.current);
  const lift = useToastStore((s) => s.lift);
  // Toasts sit above the keyboard rather than behind it.
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => setKeyboard(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboard(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => {
      if (useToastStore.getState().current?.id === toast.id) useToastStore.setState({ current: null });
    }, toast.duration);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!toast) return null;
  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { justifyContent: 'flex-end', paddingBottom: keyboard ? keyboard + 12 : insets.bottom + 20 + lift }]}>
      <Animated.View
        key={toast.id}
        entering={FadeInDown.duration(220)}
        exiting={FadeOutDown.duration(180)}
        style={{
          marginHorizontal: theme.space.gutter,
          alignSelf: 'center',
          maxWidth: 520,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 16,
          paddingLeft: 18,
          paddingRight: toast.action ? 8 : 18,
          paddingVertical: toast.action ? 6 : 13,
          borderRadius: theme.radius.lg,
          backgroundColor: theme.colors.ink,
          shadowColor: '#000',
          shadowOpacity: 0.18,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 },
          elevation: 6,
        }}
        accessibilityLiveRegion="polite"
      >
        <Text variant="callout" style={{ color: theme.colors.bg, flexShrink: 1 }}>
          {toast.message}
        </Text>
        {toast.action ? (
          <Pressable
            onPress={() => {
              toast.action!.onPress();
              useToastStore.setState({ current: null });
            }}
            style={{ paddingHorizontal: 12, paddingVertical: 8 }}
            accessibilityRole="button"
          >
            <Text variant="metaStrong" style={{ color: theme.colors.accentSoft, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.8 }}>
              {toast.action.label}
            </Text>
          </Pressable>
        ) : null}
      </Animated.View>
    </View>
  );
}
