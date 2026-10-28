import type { LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';

import { useTheme } from '@/theme';

import { Pressable } from './Pressable';
import { Sheet } from './Sheet';
import { Text } from './Text';

export type SheetAction = {
  label: string;
  icon: LucideIcon;
  onPress: () => void;
  danger?: boolean;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  actions: SheetAction[];
};

/** A list of actions in a bottom sheet; replaces Android alert dialogs. */
export function ActionSheet({ visible, onClose, title, subtitle, actions }: Props) {
  const theme = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose}>
      {title ? (
        <View style={{ paddingHorizontal: theme.space.gutter, paddingBottom: 10 }}>
          <Text variant="listTitle" numberOfLines={2}>
            {title}
          </Text>
          {subtitle ? (
            <Text variant="meta" tone="tertiary" style={{ marginTop: 4 }} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      ) : null}
      <View style={{ paddingBottom: 6 }}>
        {actions.map((a) => {
          const color = a.danger ? theme.colors.danger : theme.colors.ink;
          return (
            <Pressable
              key={a.label}
              pressScale={1}
              accessibilityRole="button"
              onPress={() => {
                onClose();
                // Let the sheet start closing before heavy work or navigation.
                setTimeout(a.onPress, 60);
              }}
              style={{
                height: 54,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 16,
                paddingHorizontal: theme.space.gutter,
              }}
            >
              <a.icon size={20} color={color} strokeWidth={1.75} />
              <Text variant="body" tone={a.danger ? 'danger' : 'ink'}>
                {a.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}
