import type { ReactNode } from 'react';
import { View } from 'react-native';

import { useTheme } from '@/theme';

import { Text } from './Text';

type Props = { title: string; body?: string; children?: ReactNode; mark?: string };

/** Typographic empty state: an ornament, a serif line, a quiet explanation, actions. */
export function EmptyState({ title, body, children, mark = '❦' }: Props) {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 36, paddingVertical: 48 }}>
      <Text style={{ fontFamily: theme.fonts.serif, fontSize: 28, color: theme.colors.accent, marginBottom: 18 }}>{mark}</Text>
      <Text variant="title" style={{ marginBottom: 10 }}>
        {title}
      </Text>
      {body ? (
        <Text variant="body" tone="secondary" style={{ marginBottom: 28 }}>
          {body}
        </Text>
      ) : null}
      {children ? <View style={{ gap: 10 }}>{children}</View> : null}
    </View>
  );
}
