import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme';

import { IconButton } from './IconButton';
import { Text } from './Text';

type Props = {
  title?: string;
  subtitle?: string;
  /** Large serif title below the bar, editorial style. */
  large?: boolean;
  right?: ReactNode;
  back?: boolean;
};

export function ScreenHeader({ title, subtitle, large = true, right, back = true }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View style={{ paddingTop: insets.top, backgroundColor: theme.colors.bg }}>
      <View style={{ height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 }}>
        {back ? <IconButton icon={ArrowLeft} label="Back" onPress={() => router.back()} /> : <View style={{ width: 12 }} />}
        {!large && title ? (
          <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1, marginLeft: 4 }}>
            {title}
          </Text>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>{right}</View>
      </View>
      {large && title ? (
        <View style={{ paddingHorizontal: theme.space.gutter, paddingBottom: 12 }}>
          <Text variant="display" accessibilityRole="header">
            {title}
          </Text>
          {subtitle ? (
            <Text variant="meta" tone="tertiary" style={{ marginTop: 4 }}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
