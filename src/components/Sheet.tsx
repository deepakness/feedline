import { useEffect, useState, type ReactNode } from 'react';
import { BackHandler, Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { GestureDetector, GestureHandlerRootView, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useStyles, useTheme } from '@/theme';

import { Text } from './Text';

type Props = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** Max height as a fraction of the screen. */
  maxHeight?: number;
  /** Let the content fill to maxHeight (for lists). */
  fill?: boolean;
};

const EASE = Easing.bezier(0.2, 0.8, 0.2, 1);

/**
 * Bottom sheet built on Modal + Reanimated: slides up over a scrim, closes on
 * scrim tap, back button, or a downward drag on the handle.
 */
export function Sheet({ visible, onClose, title, children, maxHeight = 0.86, fill }: Props) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  // Mount as soon as we become visible (state adjusted during render, not in an effect).
  if (visible && !mounted) setMounted(true);
  const progress = useSharedValue(0);
  const drag = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      drag.set(0);
      progress.set(withTiming(1, { duration: theme.motion.slow, easing: EASE }));
    } else if (mounted) {
      progress.set(
        withTiming(0, { duration: theme.motion.base, easing: EASE }, (done) => {
          if (done) runOnJS(setMounted)(false);
        }),
      );
      // Backstop: a transparent Modal left mounted would swallow every touch in the app.
      const timer = setTimeout(() => setMounted(false), theme.motion.base + 120);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  const fast = theme.motion.fast;
  const pan = usePanGesture({
    activeOffsetY: 6,
    onUpdate: (e) => {
      'worklet';
      drag.set(Math.max(0, e.translationY));
    },
    onDeactivate: (e) => {
      'worklet';
      if (e.translationY > 90 || e.velocityY > 900) runOnJS(onClose)();
      else drag.set(withTiming(0, { duration: fast }));
    },
  });

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * height * 0.6 + drag.value }],
    opacity: Math.min(1, progress.value * 3),
  }));

  if (!mounted) return null;

  return (
    <Modal transparent visible statusBarTranslucent navigationBarTranslucent animationType="none" onRequestClose={onClose}>
      {/* Modals render outside the app root, so gestures need their own root view. */}
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      </Animated.View>
      <View style={styles.anchor} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.sheet,
            { maxHeight: height * maxHeight, paddingBottom: insets.bottom + 8 },
            fill && { height: height * maxHeight },
            sheetStyle,
          ]}
        >
          <GestureDetector gesture={pan}>
            <View style={styles.handleArea}>
              <View style={styles.handle} />
              {title ? (
                <Text variant="title" style={styles.title}>
                  {title}
                </Text>
              ) : null}
            </View>
          </GestureDetector>
          {children}
        </Animated.View>
      </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const makeStyles = (t: ReturnType<typeof useTheme>) => ({
  scrim: { backgroundColor: t.colors.scrim },
  anchor: { flex: 1, justifyContent: 'flex-end' as const },
  sheet: {
    backgroundColor: t.colors.bg,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: 'hidden' as const,
  },
  handleArea: { paddingTop: 10, paddingBottom: 6, paddingHorizontal: t.space.gutter },
  handle: {
    alignSelf: 'center' as const,
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: t.colors.hairline,
    marginBottom: 12,
  },
  title: { marginBottom: 6 },
});
