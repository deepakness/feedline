import { Minus, Plus } from 'lucide-react-native';
import { View } from 'react-native';

import { READER_LINE_HEIGHTS, READER_SIZES, useSettings } from '@/state/settings';
import { useTheme } from '@/theme';

import { IconButton } from './IconButton';
import { Segmented } from './Misc';
import { Sheet } from './Sheet';
import { Text } from './Text';

/** The "Aa" sheet: text size, line spacing and typeface. Changes apply live. */
export function ReaderSettingsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  const size = useSettings((s) => s.readerSize);
  const lineHeight = useSettings((s) => s.readerLineHeight);
  const family = useSettings((s) => s.readerFamily);
  const set = useSettings((s) => s.set);
  const idx = READER_SIZES.indexOf(size as (typeof READER_SIZES)[number]);
  const sizeIndex = idx < 0 ? 3 : idx;

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={{ paddingBottom: 12 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            marginHorizontal: theme.space.gutter,
            marginBottom: 16,
            height: 56,
            borderRadius: theme.radius.md,
            borderWidth: 1,
            borderColor: theme.colors.hairline,
            backgroundColor: theme.colors.surface,
          }}
        >
          <IconButton
            icon={Minus}
            label="Smaller text"
            disabled={sizeIndex === 0}
            onPress={() => set({ readerSize: READER_SIZES[Math.max(0, sizeIndex - 1)] })}
            style={{ width: 64 }}
          />
          <View style={{ flex: 1, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 10 }}>
            <Text style={{ fontFamily: family === 'serif' ? theme.fonts.serif : theme.fonts.sans, fontSize: 14, color: theme.colors.inkSecondary }}>
              A
            </Text>
            <View style={{ flexDirection: 'row', gap: 5 }}>
              {READER_SIZES.map((s, i) => (
                <View
                  key={s}
                  style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: i <= sizeIndex ? theme.colors.ink : theme.colors.hairline }}
                />
              ))}
            </View>
            <Text style={{ fontFamily: family === 'serif' ? theme.fonts.serif : theme.fonts.sans, fontSize: 22, color: theme.colors.ink }}>
              A
            </Text>
          </View>
          <IconButton
            icon={Plus}
            label="Larger text"
            disabled={sizeIndex === READER_SIZES.length - 1}
            onPress={() => set({ readerSize: READER_SIZES[Math.min(READER_SIZES.length - 1, sizeIndex + 1)] })}
            style={{ width: 64 }}
          />
        </View>

        <Text variant="section" tone="tertiary" style={{ paddingHorizontal: theme.space.gutter, marginBottom: 8 }}>
          Typeface
        </Text>
        <Segmented
          options={[
            { label: 'Serif', value: 'serif' as const },
            { label: 'Sans', value: 'sans' as const },
          ]}
          value={family}
          onChange={(v) => set({ readerFamily: v })}
        />
        <Text variant="section" tone="tertiary" style={{ paddingHorizontal: theme.space.gutter, marginTop: 12, marginBottom: 8 }}>
          Line spacing
        </Text>
        <Segmented
          options={[
            { label: 'Compact', value: READER_LINE_HEIGHTS[0] },
            { label: 'Normal', value: READER_LINE_HEIGHTS[1] },
            { label: 'Relaxed', value: READER_LINE_HEIGHTS[2] },
          ]}
          value={lineHeight as (typeof READER_LINE_HEIGHTS)[number]}
          onChange={(v) => set({ readerLineHeight: v })}
        />
      </View>
    </Sheet>
  );
}
