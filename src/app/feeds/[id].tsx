import { useLocalSearchParams, useRouter } from 'expo-router';
import { CheckCheck, List, RotateCw, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionSheet } from '@/components/ActionSheet';
import { Button } from '@/components/Button';
import { FeedIcon } from '@/components/FeedIcon';
import { Divider, Row, SectionTitle, Segmented } from '@/components/Misc';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Text } from '@/components/Text';
import { showToast } from '@/components/Toast';
import { countArticles, markAllRead, markUnread } from '@/db/articles';
import { deleteFeed, getFeed, renameFeed, setFullTextMode } from '@/db/feeds';
import type { FullTextMode } from '@/db/types';
import { useQuery } from '@/db/useQuery';
import { deleteArticleImages } from '@/feeds/images';
import { refreshOne } from '@/feeds/refresh';
import { agoLabel } from '@/lib/time';
import { openInBrowser } from '@/lib/articleActions';
import { clearKeptRead } from '@/state/readKeep';
import { useTheme } from '@/theme';

export default function FeedDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const feedId = Number(id);
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: feed } = useQuery(() => getFeed(feedId), [feedId], ['feeds']);
  const { data: counts } = useQuery(() => countArticles({ kind: 'feed', feedId, hideRead: false }), [feedId], ['articles']);
  // null until the user edits; shows the stored name until then.
  const [draft, setDraft] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (feed === null) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
        <ScreenHeader title="Feed removed" />
      </View>
    );
  }
  if (!feed) return <View style={{ flex: 1, backgroundColor: theme.colors.bg }} />;

  const displayName = feed.custom_title || feed.title || feed.url;
  const name = draft ?? feed.custom_title ?? feed.title;

  const saveName = () => {
    const trimmed = name.trim();
    if (trimmed === (feed.custom_title ?? feed.title)) return;
    // Clearing the field, or typing the feed's own title, removes the override.
    renameFeed(feed.id, !trimmed || trimmed === feed.title ? null : trimmed);
  };

  const doRefresh = async () => {
    setRefreshing(true);
    const r = await refreshOne(feed.id);
    setRefreshing(false);
    showToast(r.error ? r.error : r.added ? `${r.added} new ${r.added === 1 ? 'article' : 'articles'}` : 'No new articles');
  };

  const markRead = async () => {
    const ids = await markAllRead({ kind: 'feed', feedId: feed.id, hideRead: false });
    clearKeptRead();
    showToast(`Marked ${ids.length} as read`, { action: { label: 'Undo', onPress: () => markUnread(ids) } });
  };

  const unsubscribe = async () => {
    const ids = await deleteFeed(feed.id);
    deleteArticleImages(ids);
    showToast(`Unsubscribed from ${displayName}`);
    router.back();
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScreenHeader title={displayName} large={false} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', paddingTop: 8, paddingBottom: 20, paddingHorizontal: theme.space.gutter }}>
          <FeedIcon name={displayName} uri={feed.icon_path} size={56} />
          {/* Stretched: a centred, shrink-wrapped Text is measured too narrow on Android and clips its last word. */}
          <Text variant="title" style={{ marginTop: 14, textAlign: 'center', alignSelf: 'stretch' }}>
            {displayName}
          </Text>
          {feed.description ? (
            <Text variant="callout" tone="secondary" style={{ marginTop: 6, textAlign: 'center', alignSelf: 'stretch' }} numberOfLines={3}>
              {feed.description}
            </Text>
          ) : null}
          <Text variant="meta" tone="tertiary" style={{ marginTop: 10 }}>
            {counts
              ? counts.total
                ? `${counts.total} ${counts.total === 1 ? 'article' : 'articles'} · ${counts.unread} unread`
                : 'No recent articles'
              : ' '}
          </Text>
        </View>

        {feed.last_error ? (
          <View style={{ marginHorizontal: theme.space.gutter, marginBottom: 8, padding: 14, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceSunken }}>
            <Text variant="metaStrong" tone="danger">
              Last refresh failed
            </Text>
            <Text variant="callout" tone="secondary" style={{ marginTop: 4 }}>
              {feed.last_error}
            </Text>
          </View>
        ) : null}

        <SectionTitle>Name</SectionTitle>
        <TextInput
          value={name}
          onChangeText={setDraft}
          onBlur={saveName}
          onSubmitEditing={saveName}
          placeholder={feed.title || 'Feed name'}
          placeholderTextColor={theme.colors.inkTertiary}
          selectionColor={theme.colors.accent}
          returnKeyType="done"
          style={[
            theme.type.body,
            {
              color: theme.colors.ink,
              marginHorizontal: theme.space.gutter,
              height: 48,
              paddingHorizontal: 14,
              borderRadius: theme.radius.md,
              borderWidth: 1,
              borderColor: theme.colors.hairline,
              backgroundColor: theme.colors.surface,
            },
          ]}
        />

        <SectionTitle>Full article text</SectionTitle>
        <Segmented<FullTextMode>
          options={[
            { label: 'Auto', value: 'auto' },
            { label: 'Always', value: 'always' },
            { label: 'Never', value: 'never' },
          ]}
          value={feed.full_text_mode}
          onChange={(v) => setFullTextMode(feed.id, v)}
        />
        <Text variant="meta" tone="tertiary" style={{ paddingHorizontal: theme.space.gutter }}>
          {feed.full_text_mode === 'auto'
            ? 'Downloads the full page when the feed only includes a summary.'
            : feed.full_text_mode === 'always'
              ? 'Always downloads the article page for offline reading.'
              : 'Only keeps what the feed itself provides.'}
        </Text>

        <SectionTitle>Details</SectionTitle>
        <Row label="Feed address" detail={feed.url} />
        <Divider inset={theme.space.gutter} />
        {feed.site_url ? (
          <>
            <Row label="Website" detail={feed.site_url} onPress={() => openInBrowser(feed.site_url)} />
            <Divider inset={theme.space.gutter} />
          </>
        ) : null}
        <Row label="Last updated" value={feed.last_success_at ? agoLabel(feed.last_success_at) : 'Never'} />

        <View style={{ paddingHorizontal: theme.space.gutter, gap: 10, marginTop: 28 }}>
          {counts?.total ? (
            <Button label="Show articles" icon={List} onPress={() => router.dismissTo({ pathname: '/', params: { feed: String(feed.id), at: String(Date.now()) } })} />
          ) : null}
          {counts?.unread ? <Button label="Mark all as read" icon={CheckCheck} kind="secondary" onPress={markRead} /> : null}
          <Button label="Refresh this feed" icon={RotateCw} kind="secondary" loading={refreshing} onPress={doRefresh} />
          <Button label="Unsubscribe" icon={Trash2} kind="danger" onPress={() => setConfirmOpen(true)} />
        </View>
      </ScrollView>

      <ActionSheet
        visible={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={`Unsubscribe from ${displayName}?`}
        subtitle="Its articles will be removed, including saved ones."
        actions={[{ label: 'Unsubscribe', icon: Trash2, danger: true, onPress: unsubscribe }]}
      />
    </View>
  );
}
