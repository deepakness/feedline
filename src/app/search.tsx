import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { ArrowLeft, ChevronDown, X } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/EmptyState';
import { FeedIcon } from '@/components/FeedIcon';
import { FeedPickerSheet, type FeedSelection } from '@/components/FeedPickerSheet';
import { IconButton } from '@/components/IconButton';
import { Divider } from '@/components/Misc';
import { Pressable } from '@/components/Pressable';
import { Text } from '@/components/Text';
import { countArticles, searchArticles, type SearchHit } from '@/db/articles';
import { listFeedSummaries } from '@/db/feeds';
import type { ArticleFilter } from '@/db/types';
import { useQuery } from '@/db/useQuery';
import { relativeTime } from '@/lib/time';
import { useReaderSession } from '@/state/readerSession';
import { useSettings } from '@/state/settings';
import { useTheme } from '@/theme';

/** Renders an FTS snippet, highlighting the \u0001…\u0002 marked matches. */
function Snippet({ text }: { text: string }) {
  const theme = useTheme();
  const parts = text.split(/(\u0001[^\u0002]*\u0002)/g).filter(Boolean);
  return (
    <Text variant="callout" tone="secondary" numberOfLines={2} style={{ marginTop: 4 }}>
      {parts.map((p, i) =>
        p.startsWith('\u0001') ? (
          <Text key={i} variant="callout" style={{ color: theme.colors.ink, backgroundColor: theme.colors.accentSoft }}>
            {p.slice(1, -1)}
          </Text>
        ) : (
          p.replace(/\s+/g, ' ')
        ),
      )}
    </Text>
  );
}

export default function SearchScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const recent = useSettings((s) => s.recentSearches);
  const setSettings = useSettings((s) => s.set);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[] | null>(null);
  const [scope, setScope] = useState<FeedSelection>({ kind: 'all' });
  const [scopeOpen, setScopeOpen] = useState(false);
  const { data: feeds } = useQuery(listFeedSummaries, [], ['feeds', 'articles']);
  const { data: savedCounts } = useQuery(() => countArticles({ kind: 'saved', hideRead: false }), [], ['articles']);
  const totalUnread = useMemo(() => (feeds ?? []).reduce((n, f) => n + f.unread, 0), [feeds]);
  const scopeFeed = scope.kind === 'feed' ? feeds?.find((f) => f.id === scope.feedId) : undefined;
  const scopeLabel = scope.kind === 'all' ? 'All articles' : scope.kind === 'saved' ? 'Saved' : (scopeFeed?.name ?? 'Feed');
  const scopeFilter = useMemo<ArticleFilter | undefined>(
    () =>
      scope.kind === 'all'
        ? undefined
        : scope.kind === 'saved'
          ? { kind: 'saved', hideRead: false }
          : { kind: 'feed', feedId: scope.feedId, hideRead: false },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope.kind, scope.kind === 'feed' ? scope.feedId : 0],
  );

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchArticles(q, scopeFilter)
        .then((r) => !cancelled && setResults(r))
        .catch(() => !cancelled && setResults([]));
    }, 160);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, scopeFilter]);

  const remember = () => {
    const q = query.trim();
    if (!q) return;
    setSettings({ recentSearches: [q, ...recent.filter((r) => r !== q)].slice(0, 8) });
  };

  const open = (hit: SearchHit) => {
    remember();
    useReaderSession.setState({ ids: (results ?? []).map((r) => r.id), origin: 'search', lastId: hit.id });
    router.push({ pathname: '/article/[id]', params: { id: String(hit.id) } });
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg, paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, height: 60, gap: 4 }}>
        <IconButton icon={ArrowLeft} label="Back" onPress={() => router.back()} />
        <View
          style={{
            flex: 1,
            height: 44,
            borderRadius: theme.radius.md,
            backgroundColor: theme.colors.surfaceSunken,
            flexDirection: 'row',
            alignItems: 'center',
            paddingLeft: 14,
            marginRight: 8,
          }}
        >
          <TextInput
            autoFocus
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={remember}
            placeholder="Search your articles"
            placeholderTextColor={theme.colors.inkTertiary}
            returnKeyType="search"
            selectionColor={theme.colors.accent}
            style={[theme.type.body, { flex: 1, color: theme.colors.ink, paddingVertical: 0 }]}
          />
          {query ? <IconButton icon={X} size={18} label="Clear" onPress={() => setQuery('')} color={theme.colors.inkTertiary} /> : null}
        </View>
      </View>
      {feeds && feeds.length > 1 ? (
        <View style={{ flexDirection: 'row', paddingHorizontal: theme.space.gutter, paddingBottom: 8 }}>
          <Pressable
            onPress={() => setScopeOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`Searching ${scopeLabel}. Change`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              maxWidth: '100%',
              height: 32,
              paddingLeft: 12,
              paddingRight: 8,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: theme.colors.hairline,
              backgroundColor: scope.kind === 'all' ? theme.colors.surface : theme.colors.accentSoft,
            }}
          >
            <Text variant="meta" tone="secondary" numberOfLines={1} style={{ flexShrink: 1 }}>
              In {scopeLabel}
            </Text>
            <ChevronDown size={16} color={theme.colors.inkTertiary} strokeWidth={2} />
          </Pressable>
        </View>
      ) : null}

      {!query.trim() || results === null ? (
        recent.length ? (
          <View style={{ paddingHorizontal: theme.space.gutter, paddingTop: 16 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text variant="section" tone="tertiary">
                Recent
              </Text>
              <Pressable onPress={() => setSettings({ recentSearches: [] })} accessibilityRole="button" accessibilityLabel="Clear recent searches" hitSlop={14}>
                <Text variant="meta" tone="accent">
                  Clear
                </Text>
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {recent.map((r) => (
                <Pressable
                  key={r}
                  onPress={() => setQuery(r)}
                  accessibilityRole="button"
                  hitSlop={{ top: 6, bottom: 6 }}
                  style={{ paddingHorizontal: 14, height: 36, justifyContent: 'center', borderRadius: 18, borderWidth: 1, borderColor: theme.colors.hairline, backgroundColor: theme.colors.surface }}
                >
                  <Text variant="callout">{r}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          <EmptyState mark="⌕" title="Search everything you’ve fetched" body="Titles, authors and full article text, all offline." />
        )
      ) : results.length === 0 ? (
        <EmptyState mark="⌕" title="No matches" body={`Nothing you’ve downloaded${scope.kind === 'all' ? '' : ` in ${scopeLabel}`} mentions “${query.trim()}”.`} />
      ) : (
        <FlashList
          data={results}
          keyExtractor={(r) => String(r.id)}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ItemSeparatorComponent={() => <Divider inset={theme.space.gutter} />}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          renderItem={({ item }) => (
            <Pressable onPress={() => open(item)} pressScale={1} accessibilityRole="button" style={{ paddingHorizontal: theme.space.gutter, paddingVertical: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <FeedIcon name={item.feed_name} uri={item.feed_icon} size={16} />
                <Text variant="metaStrong" tone="secondary" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {item.feed_name}
                </Text>
                <Text variant="meta" tone="tertiary">
                  · {relativeTime(item.published_at)}
                </Text>
              </View>
              <Text variant="listTitle" numberOfLines={2} style={{ marginTop: 6, color: item.is_read ? theme.colors.inkSecondary : theme.colors.ink }}>
                {item.title}
              </Text>
              {item.snippet ? <Snippet text={item.snippet} /> : null}
            </Pressable>
          )}
        />
      )}

      <FeedPickerSheet
        visible={scopeOpen}
        onClose={() => setScopeOpen(false)}
        feeds={feeds ?? []}
        totalUnread={totalUnread}
        savedCount={savedCounts?.total ?? 0}
        selection={scope}
        onSelect={setScope}
      />
    </View>
  );
}
