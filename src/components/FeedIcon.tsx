import { Image } from 'expo-image';
import { useState } from 'react';
import { View } from 'react-native';

import { hash } from '@/lib/hash';
import { useTheme } from '@/theme';

import { Text } from './Text';

type Props = { name: string; uri: string | null; size?: number };

/** Feed favicon, or a soft monogram tile when there is none (or it fails to load). */
export function FeedIcon({ name, uri, size = 20 }: Props) {
  const theme = useTheme();
  const [failed, setFailed] = useState(false);
  const radius = Math.round(size * 0.24);

  if (uri && !failed) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: radius, backgroundColor: theme.colors.surfaceSunken }}
        contentFit="cover"
        onError={() => setFailed(true)}
        recyclingKey={uri}
        cachePolicy="memory-disk"
      />
    );
  }
  const palette = theme.colors.monogram;
  const bg = palette[parseInt(hash(name), 36) % palette.length];
  const letter = (name.replace(/^(the|a)\s+/i, '').match(/[\p{L}\p{N}]/u)?.[0] ?? '•').toUpperCase();
  return (
    <View
      style={{ width: size, height: size, borderRadius: radius, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}
    >
      <Text variant="metaStrong"
        style={{ fontSize: Math.round(size * 0.52), lineHeight: Math.round(size * 0.66), fontFamily: theme.fonts.serifStrong, letterSpacing: 0 }}
        tone="secondary"
        maxFontSizeMultiplier={1}
      >
        {letter}
      </Text>
    </View>
  );
}
