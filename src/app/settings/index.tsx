import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionSheet } from '@/components/ActionSheet';
import { Divider, Row, SectionTitle, Segmented, Switch } from '@/components/Misc';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Text } from '@/components/Text';
import { showToast } from '@/components/Toast';
import { db, writeTransaction } from '@/db/client';
import { notifyChangeNow } from '@/db/bus';
import { findFeedByUrl, insertFeed, renameFeed, setFullTextMode } from '@/db/feeds';
import { useQuery } from '@/db/useQuery';
import { syncBackgroundRefresh } from '@/feeds/background';
import { imagesRoot, storageUsage } from '@/feeds/images';
import { refreshOne } from '@/feeds/refresh';
import { applyRetention } from '@/feeds/retention';
import { openInBrowser } from '@/lib/articleActions';
import { saveOpmlToDevice, shareOpml } from '@/opml/io';
import { useSettings, type FeedSort, type ImageMode, type ListStyle, type RetentionDays } from '@/state/settings';
import { useTheme } from '@/theme';
import { Download, Share2, Trash2 } from 'lucide-react-native';

// GitHub's Atom feed of Feedline releases, so updates arrive like any other article.
const RELEASES_FEED_URL = 'https://github.com/deepakness/feedline/releases.atom';
const RELEASES_PAGE_URL = 'https://github.com/deepakness/feedline/releases';

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function SettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const s = useSettings();
  // Measuring walks every image folder synchronously, so it waits for the screen transition.
  const [usage, setUsage] = useState<{ images: number; database: number } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [following, setFollowing] = useState(false);
  const { data: updatesFeed } = useQuery(() => findFeedByUrl(RELEASES_FEED_URL), [], ['feeds']);

  const followUpdates = async () => {
    setFollowing(true);
    try {
      const id = await insertFeed({ url: RELEASES_FEED_URL, siteUrl: RELEASES_PAGE_URL });
      // A custom title survives refreshes, which would rename it "Release notes from feedline".
      await renameFeed(id, 'Feedline updates');
      // Release notes are complete in the feed; fetching the GitHub page would only add clutter.
      await setFullTextMode(id, 'never');
      const result = await refreshOne(id);
      showToast(result.error ? `Following updates, but the first refresh failed: ${result.error}` : 'Following Feedline updates');
    } catch {
      showToast('Could not follow updates');
    } finally {
      setFollowing(false);
    }
  };

  const setBackgroundRefresh = async (enabled: boolean) => {
    s.set({ backgroundRefresh: enabled });
    const ok = await syncBackgroundRefresh(enabled).catch(() => false);
    if (!ok) {
      s.set({ backgroundRefresh: false });
      showToast('Android isn’t allowing background work for Feedline');
    }
  };

  const measure = () => setUsage(storageUsage());
  useEffect(() => {
    const timer = setTimeout(() => setUsage(storageUsage()), 400);
    return () => clearTimeout(timer);
  }, []);

  const setRetention = async (days: RetentionDays) => {
    s.set({ retentionDays: days });
    const removed = await applyRetention();
    if (removed) showToast(`Removed ${removed} old ${removed === 1 ? 'article' : 'articles'}`);
    measure();
  };

  const clearImages = async () => {
    try {
      const root = imagesRoot();
      if (root.exists) root.delete();
    } catch {
      // ignore
    }
    // Point every local image back at its remote URL so it loads from the web again.
    const rows = await db().getAllAsync<{ article_id: number; content_html: string }>(
      `SELECT article_id, content_html FROM article_bodies WHERE content_html LIKE '%src="images/%'`,
    );
    await writeTransaction(async (conn) => {
      for (const r of rows) {
        const html = r.content_html.replace(/src="images\/[^"]*" data-remote="([^"]*)"/g, 'src="$1" data-remote="$1"');
        await conn.runAsync('UPDATE article_bodies SET content_html = ? WHERE article_id = ?', [html, r.article_id]);
      }
      await conn.runAsync(`UPDATE articles SET images_status = 'skipped', thumb_path = NULL WHERE images_status != 'skipped' OR thumb_path IS NOT NULL`);
    });
    notifyChangeNow('articles');
    measure();
    showToast('Image cache cleared');
  };

  const doSave = async () => {
    try {
      const r = await saveOpmlToDevice();
      if (r) showToast(`Saved ${r.count} feeds to ${r.name}`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Export failed');
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScreenHeader title="Settings" />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
        <SectionTitle>Article list</SectionTitle>
        <Segmented<ListStyle>
          options={[
            { label: 'Standard', value: 'standard' },
            { label: 'Compact', value: 'compact' },
            { label: 'Cards', value: 'cards' },
          ]}
          value={s.listStyle}
          onChange={(v) => s.set({ listStyle: v })}
        />
        <Row label="Hide read articles" right={<Switch label="Hide read articles" value={s.hideRead} onValueChange={(v) => s.set({ hideRead: v })} />} />
        <Text variant="body" style={{ paddingHorizontal: theme.space.gutter, paddingTop: 14, paddingBottom: 10 }}>
          Sort feeds by
        </Text>
        <Segmented<FeedSort>
          options={[
            { label: 'Name', value: 'name' },
            { label: 'Unread', value: 'unread' },
          ]}
          value={s.feedSort}
          onChange={(v) => s.set({ feedSort: v })}
        />

        <SectionTitle>Refreshing</SectionTitle>
        <Row
          label="Refresh when opening the app"
          detail="Only if the last refresh was over an hour ago"
          right={<Switch label="Refresh when opening the app" value={s.refreshOnOpen} onValueChange={(v) => s.set({ refreshOnOpen: v })} />}
        />
        <Divider inset={theme.space.gutter} />
        <Row
          label="Refresh in the background"
          detail="Every few hours, when Android allows. New articles are waiting when you open the app."
          right={<Switch label="Refresh in the background" value={s.backgroundRefresh} onValueChange={setBackgroundRefresh} />}
        />
        <Divider inset={theme.space.gutter} />
        <Row
          label="Fetch full articles"
          detail="When a feed only includes a summary"
          right={
            <Switch
              label="Fetch full articles"
              value={s.fullTextDefault === 'auto'}
              onValueChange={(v) => s.set({ fullTextDefault: v ? 'auto' : 'never' })}
            />
          }
        />
        <Text variant="body" style={{ paddingHorizontal: theme.space.gutter, paddingTop: 14, paddingBottom: 10 }}>
          Download images for offline reading
        </Text>
        <Segmented<ImageMode>
          options={[
            { label: 'Always', value: 'always' },
            { label: 'Wi-Fi only', value: 'wifi' },
            { label: 'Never', value: 'off' },
          ]}
          value={s.imageMode}
          onChange={(v) => s.set({ imageMode: v })}
        />

        <SectionTitle>Storage</SectionTitle>
        <Text variant="body" style={{ paddingHorizontal: theme.space.gutter, paddingBottom: 4 }}>
          Keep articles for
        </Text>
        <Text variant="meta" tone="tertiary" style={{ paddingHorizontal: theme.space.gutter, paddingBottom: 10 }}>
          Saved articles are always kept.
        </Text>
        <Segmented<RetentionDays>
          options={[
            { label: '7 days', value: 7 },
            { label: '30 days', value: 30 },
            { label: '90 days', value: 90 },
            { label: 'Forever', value: 0 },
          ]}
          value={s.retentionDays}
          onChange={setRetention}
        />
        <Row
          label="Space used"
          value={usage ? formatBytes(usage.images + usage.database) : '…'}
          detail={usage ? `${formatBytes(usage.database)} articles · ${formatBytes(usage.images)} images` : undefined}
        />
        <Divider inset={theme.space.gutter} />
        <Row label="Clear image cache" danger onPress={() => setClearOpen(true)} />

        <SectionTitle>Subscriptions</SectionTitle>
        <Row label="Import OPML" detail="Bring feeds from another reader" onPress={() => router.push('/settings/opml-import')} />
        <Divider inset={theme.space.gutter} />
        <Row label="Export OPML" detail="Back up or move your feeds" onPress={() => setExportOpen(true)} />
        <Divider inset={theme.space.gutter} />
        <Row label="Manage feeds" onPress={() => router.push('/feeds')} />

        <SectionTitle>About</SectionTitle>
        <Row
          label="Feedline"
          detail="Release notes and downloads"
          value={`v${Constants.expoConfig?.version ?? '1.0.0'}`}
          onPress={() => openInBrowser(RELEASES_PAGE_URL)}
        />
        {updatesFeed !== undefined ? (
          <>
            <Divider inset={theme.space.gutter} />
            {updatesFeed ? (
              <Row
                label="Following Feedline updates"
                detail="New versions show up in your timeline"
                onPress={() => router.push(`/feeds/${updatesFeed.id}`)}
              />
            ) : (
              <Row
                label="Follow Feedline updates"
                detail="Get new versions in your timeline, like any other feed"
                disabled={following}
                onPress={followUpdates}
              />
            )}
          </>
        ) : null}
        <Text variant="meta" tone="tertiary" style={{ paddingHorizontal: theme.space.gutter, paddingTop: 4 }}>
          Everything stays on this phone. No accounts, no tracking.
        </Text>
      </ScrollView>

      <ActionSheet
        visible={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Export subscriptions"
        subtitle="An OPML file any feed reader can import"
        actions={[
          { label: 'Save to device', icon: Download, onPress: doSave },
          { label: 'Share…', icon: Share2, onPress: () => shareOpml().catch(() => showToast('Export failed')) },
        ]}
      />
      <ActionSheet
        visible={clearOpen}
        onClose={() => setClearOpen(false)}
        title="Clear downloaded images?"
        subtitle="Images will load from the web again when you’re online."
        actions={[{ label: 'Clear image cache', icon: Trash2, danger: true, onPress: clearImages }]}
      />
    </View>
  );
}
