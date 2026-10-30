import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { AlertCircle, Plus } from 'lucide-react-native';
import { useMemo } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { FeedIcon } from '@/components/FeedIcon';
import { IconButton } from '@/components/IconButton';
import { Divider } from '@/components/Misc';
import { Pressable } from '@/components/Pressable';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Text } from '@/components/Text';
import { listFeedSummaries, sortFeeds } from '@/db/feeds';
import { useQuery } from '@/db/useQuery';
import { agoLabel } from '@/lib/time';
import { hostOf } from '@/lib/url';
import { useSettings } from '@/state/settings';
import { useTheme } from '@/theme';

export default function FeedsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const feedSort = useSettings((s) => s.feedSort);
  const { data: feeds } = useQuery(listFeedSummaries, [], ['feeds', 'articles']);
  const sorted = useMemo(() => sortFeeds(feeds ?? [], feedSort), [feeds, feedSort]);
  const failing = feeds?.filter((f) => f.last_error).length ?? 0;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScreenHeader
        title="Feeds"
        subtitle={
          feeds
            ? `${feeds.length} ${feeds.length === 1 ? 'subscription' : 'subscriptions'}${failing ? ` · ${failing} with problems` : ''}`
            : undefined
        }
        right={<IconButton icon={Plus} label="Add feed" onPress={() => router.push('/feeds/add')} />}
      />
      {feeds && feeds.length === 0 ? (
        <EmptyState title="No feeds yet" body="Add a site you like, or bring your subscriptions from another reader.">
          <Button label="Add a feed" icon={Plus} onPress={() => router.push('/feeds/add')} />
          <Button label="Import OPML" kind="secondary" onPress={() => router.push('/settings/opml-import')} />
        </EmptyState>
      ) : (
        <FlashList
          data={sorted}
          keyExtractor={(f) => String(f.id)}
          ItemSeparatorComponent={() => <Divider inset={theme.space.gutter + 44} />}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push({ pathname: '/feeds/[id]', params: { id: String(item.id) } })}
              pressScale={1}
              accessibilityRole="button"
              accessibilityLabel={`${item.name}, ${item.unread} unread`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: theme.space.gutter, paddingVertical: 14 }}
            >
              <FeedIcon name={item.name} uri={item.icon_path} size={30} />
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {item.name}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
                  {item.last_error ? <AlertCircle size={12} color={theme.colors.danger} strokeWidth={2} /> : null}
                  <Text variant="meta" tone={item.last_error ? 'danger' : 'tertiary'} numberOfLines={1} style={{ flexShrink: 1 }}>
                    {item.last_error
                      ? item.last_error
                      : `${hostOf(item.site_url ?? item.url)} · ${item.last_success_at ? agoLabel(item.last_success_at) : 'not fetched yet'}`}
                  </Text>
                </View>
              </View>
              {item.unread > 0 ? (
                <Text variant="metaStrong" tone="secondary">
                  {item.unread}
                </Text>
              ) : null}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
