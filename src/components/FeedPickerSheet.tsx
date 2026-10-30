import { FlashList } from '@shopify/flash-list';
import { Bookmark, Check, Layers, Search } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { TextInput, View } from 'react-native';

import { sortFeeds } from '@/db/feeds';
import type { FeedSummary } from '@/db/types';
import { useSettings } from '@/state/settings';
import { useTheme } from '@/theme';

import { FeedIcon } from './FeedIcon';
import { Pressable } from './Pressable';
import { Sheet } from './Sheet';
import { Text } from './Text';

export type FeedSelection = { kind: 'all' } | { kind: 'saved' } | { kind: 'feed'; feedId: number };

type Props = {
  visible: boolean;
  onClose: () => void;
  feeds: FeedSummary[];
  totalUnread: number;
  savedCount: number;
  selection: FeedSelection;
  onSelect: (s: FeedSelection) => void;
};

type Entry =
  | { key: string; type: 'special'; selection: FeedSelection; label: string; count: number; icon: 'all' | 'saved' }
  | { key: string; type: 'divider' }
  | { key: string; type: 'feed'; feed: FeedSummary };

export function FeedPickerSheet({ visible, onClose, feeds, totalUnread, savedCount, selection, onSelect }: Props) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const feedSort = useSettings((s) => s.feedSort);

  const entries = useMemo<Entry[]>(() => {
    const q = query.trim().toLowerCase();
    const sorted = sortFeeds(feeds, feedSort);
    const matching = q ? sorted.filter((f) => f.name.toLowerCase().includes(q) || f.url.toLowerCase().includes(q)) : sorted;
    const list: Entry[] = [];
    if (!q) {
      list.push({ key: 'all', type: 'special', selection: { kind: 'all' }, label: 'All articles', count: totalUnread, icon: 'all' });
      list.push({ key: 'saved', type: 'special', selection: { kind: 'saved' }, label: 'Saved', count: savedCount, icon: 'saved' });
      if (matching.length) list.push({ key: 'div', type: 'divider' });
    }
    for (const f of matching) list.push({ key: `f${f.id}`, type: 'feed', feed: f });
    return list;
  }, [feeds, feedSort, query, totalUnread, savedCount]);

  const isSelected = (s: FeedSelection) =>
    s.kind === selection.kind && (s.kind !== 'feed' || (selection.kind === 'feed' && s.feedId === selection.feedId));

  const choose = (s: FeedSelection) => {
    onSelect(s);
    close();
  };

  // Every way of dismissing the sheet starts the next visit with an empty search.
  const close = () => {
    onClose();
    setQuery('');
  };

  const renderItem = ({ item }: { item: Entry }) => {
    if (item.type === 'divider') {
      return (
        <Text variant="section" tone="tertiary" style={{ paddingHorizontal: theme.space.gutter, paddingTop: 16, paddingBottom: 6 }}>
          Feeds
        </Text>
      );
    }
    const selectionFor: FeedSelection = item.type === 'special' ? item.selection : { kind: 'feed', feedId: item.feed.id };
    const selected = isSelected(selectionFor);
    const count = item.type === 'special' ? item.count : item.feed.unread;
    const label = item.type === 'special' ? item.label : item.feed.name;
    return (
      <Pressable
        onPress={() => choose(selectionFor)}
        pressScale={1}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        style={{
          height: 52,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          paddingHorizontal: theme.space.gutter,
          backgroundColor: selected ? theme.colors.surfaceSunken : 'transparent',
        }}
      >
        {item.type === 'special' ? (
          <View style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
            {item.icon === 'all' ? (
              <Layers size={20} color={theme.colors.ink} strokeWidth={1.75} />
            ) : (
              <Bookmark size={20} color={theme.colors.ink} strokeWidth={1.75} />
            )}
          </View>
        ) : (
          <FeedIcon name={item.feed.name} uri={item.feed.icon_path} size={24} />
        )}
        <Text variant={selected ? 'bodyStrong' : 'body'} numberOfLines={1} style={{ flex: 1 }}>
          {label}
        </Text>
        {count > 0 ? (
          <Text variant="meta" tone="tertiary">
            {count}
          </Text>
        ) : null}
        {selected ? <Check size={18} color={theme.colors.accent} strokeWidth={2} /> : null}
      </Pressable>
    );
  };

  return (
    <Sheet visible={visible} onClose={close} fill={feeds.length > 8} maxHeight={0.82}>
      {feeds.length > 8 ? (
        <View
          style={{
            marginHorizontal: theme.space.gutter,
            marginBottom: 8,
            height: 44,
            borderRadius: theme.radius.md,
            backgroundColor: theme.colors.surfaceSunken,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 12,
            gap: 8,
          }}
        >
          <Search size={18} color={theme.colors.inkTertiary} strokeWidth={1.75} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Find a feed"
            placeholderTextColor={theme.colors.inkTertiary}
            style={[theme.type.body, { flex: 1, color: theme.colors.ink, paddingVertical: 0 }]}
            selectionColor={theme.colors.accent}
            autoCorrect={false}
          />
        </View>
      ) : null}
      <View style={feeds.length > 8 ? { flex: 1 } : { height: Math.min(entries.length * 52 + 40, 600) }}>
        <FlashList
          data={entries}
          renderItem={renderItem}
          keyExtractor={(e) => e.key}
          getItemType={(e) => e.type}
          keyboardShouldPersistTaps="handled"
        />
      </View>
    </Sheet>
  );
}
