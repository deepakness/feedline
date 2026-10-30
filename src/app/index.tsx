import { FlashList, type FlashListRef } from '@shopify/flash-list';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowUp,
  Bookmark,
  BookmarkMinus,
  CheckCheck,
  ChevronDown,
  CircleDot,
  Eye,
  EyeOff,
  ExternalLink,
  FileUp,
  ListChecks,
  MoreVertical,
  Plus,
  RotateCw,
  Rss,
  Search,
  Settings,
  Share2,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  cancelAnimation,
  Easing,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionSheet, type SheetAction } from '@/components/ActionSheet';
import { ArticleRow } from '@/components/ArticleRow';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { FeedPickerSheet, type FeedSelection } from '@/components/FeedPickerSheet';
import { IconButton } from '@/components/IconButton';
import { DAY_HEADER_HEIGHT, DayHeader, ProgressBar } from '@/components/Misc';
import { Pressable } from '@/components/Pressable';
import { Text } from '@/components/Text';
import { showToast } from '@/components/Toast';
import { countArticles, listArticles, markAllRead, markUnread, setRead, setSaved } from '@/db/articles';
import { listFeedSummaries } from '@/db/feeds';
import type { ArticleFilter, ArticleListItem } from '@/db/types';
import { useQuery } from '@/db/useQuery';
import { refreshFeeds } from '@/feeds/refresh';
import { openInBrowser, shareArticle } from '@/lib/articleActions';
import { setUserBusy } from '@/lib/idle';
import { agoLabel, dayLabel, startOfDay } from '@/lib/time';
import { clearKeptRead, useReadKeep } from '@/state/readKeep';
import { useReaderSession } from '@/state/readerSession';
import { useRefreshStore } from '@/state/refreshStore';
import { settings, useSettings } from '@/state/settings';
import { useTheme } from '@/theme';

type Row = { type: 'day'; key: string; label: string } | { type: 'article'; key: string; item: ArticleListItem };

const PAGE = 250;
/** Articles read before the app started are never kept by "Hide read". */
const SESSION_START = Date.now();

export default function Timeline() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const hideRead = useSettings((s) => s.hideRead);
  const listStyle = useSettings((s) => s.listStyle);
  const lastRefreshAt = useSettings((s) => s.lastRefreshAt);
  const setSettings = useSettings((s) => s.set);
  const running = useRefreshStore((s) => s.running);
  const refreshDone = useRefreshStore((s) => s.done);
  const refreshTotal = useRefreshStore((s) => s.total);
  const pendingOffline = useRefreshStore((s) => s.pendingOffline);
  const refreshedAt = useRefreshStore((s) => s.lastSummary?.finishedAt ?? 0);

  // Other screens can open the timeline on one feed (`/?feed=12&at=…`); `at` makes a
  // repeat request for the same feed count as new after the user picked another view.
  const { feed: feedParam, at: atParam } = useLocalSearchParams<{ feed?: string; at?: string }>();
  const [chosen, setSelection] = useState<FeedSelection>(() =>
    feedParam ? { kind: 'feed', feedId: Number(feedParam) } : { kind: 'all' },
  );
  const paramKey = `${feedParam ?? ''}:${atParam ?? ''}`;
  const [paramSeen, setParamSeen] = useState(paramKey);
  if (paramKey !== paramSeen) {
    setParamSeen(paramKey);
    if (feedParam) setSelection({ kind: 'feed', feedId: Number(feedParam) });
  }
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [contextItem, setContextItem] = useState<ArticleListItem | null>(null);

  const { data: feeds } = useQuery(listFeedSummaries, [], ['articles', 'feeds']);
  // If the chosen feed was unsubscribed, fall back to everything.
  const selection: FeedSelection =
    chosen.kind === 'feed' && feeds && !feeds.some((f) => f.id === chosen.feedId) ? { kind: 'all' } : chosen;

  // Saved is a reading list: what's kept there stays visible after it's been read.
  const filter: ArticleFilter = useMemo(
    () =>
      selection.kind === 'feed'
        ? { kind: 'feed', feedId: selection.feedId, hideRead }
        : { kind: selection.kind, hideRead: hideRead && selection.kind !== 'saved' },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selection.kind, selection.kind === 'feed' ? selection.feedId : 0, hideRead],
  );

  // Paging resets whenever the filter changes.
  const filterKey = JSON.stringify(filter);
  const [page, setPage] = useState({ key: filterKey, limit: PAGE });
  const limit = page.key === filterKey ? page.limit : PAGE;

  // With "Hide read", what you read stays listed until the next refresh (see readKeep).
  const clearedAt = useReadKeep((s) => s.clearedAt);
  useEffect(
    () =>
      useSettings.subscribe((s, prev) => {
        if (s.hideRead && !prev.hideRead) clearKeptRead();
      }),
    [],
  );
  const keepSince = Math.max(SESSION_START, refreshedAt, clearedAt);
  const listFilter: ArticleFilter = useMemo(
    () => (filter.hideRead ? { ...filter, keepReadSince: keepSince } : filter),
    [filter, keepSince],
  );

  const { data: latest, loading } = useQuery(() => listArticles(listFilter, limit), [listFilter, limit], ['articles', 'feeds']);
  // While the list is being dragged or flung, it keeps showing the rows it had when
  // the gesture began; updates land once it settles, so nothing shifts under the finger.
  const [held, setHeld] = useState<typeof latest | null>(null);
  const articles = held ?? latest;
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdRows = useCallback(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    setUserBusy(true);
    setHeld((h) => h ?? latest ?? null);
  }, [latest]);
  const releaseRows = useCallback((delay: number) => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    setUserBusy(false);
    settleTimer.current = setTimeout(() => setHeld(null), delay);
  }, []);
  useEffect(() => () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
  }, []);
  const { data: savedCounts } = useQuery(() => countArticles({ kind: 'saved', hideRead: false }), [], ['articles']);
  // Unread numbers come from the per-feed summary already loaded for the picker.
  const totalUnread = useMemo(() => (feeds ?? []).reduce((n, f) => n + f.unread, 0), [feeds]);

  const selectedFeed = selection.kind === 'feed' ? feeds?.find((f) => f.id === selection.feedId) : undefined;
  const title = selection.kind === 'all' ? 'All articles' : selection.kind === 'saved' ? 'Saved' : (selectedFeed?.name ?? 'Feed');

  // One-time tip: long-press is how to mark read, save or share from the list.
  const hasArticles = !!articles?.length;
  useEffect(() => {
    if (!hasArticles || settings.get().longPressTipShown) return;
    const timer = setTimeout(() => {
      settings.set({ longPressTipShown: true });
      showToast('Tip: long-press an article to save it, share it or mark it read', { duration: 5000 });
    }, 2500);
    return () => clearTimeout(timer);
  }, [hasArticles]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let currentDay = -1;
    for (const item of articles ?? []) {
      if (selection.kind !== 'saved') {
        const day = startOfDay(item.published_at);
        if (day !== currentDay) {
          currentDay = day;
          out.push({ type: 'day', key: `d${day}`, label: dayLabel(day) });
        }
      }
      out.push({ type: 'article', key: `a${item.id}`, item });
    }
    return out;
  }, [articles, selection.kind]);

  const stickyIndices = useMemo(() => rows.flatMap((r, i) => (r.type === 'day' ? [i] : [])), [rows]);

  const listRef = useRef<FlashListRef<Row>>(null);
  const rowsRef = useRef(rows);
  const selectionRef = useRef(selection);
  useEffect(() => {
    rowsRef.current = rows;
    selectionRef.current = selection;
  });
  const openedIdRef = useRef<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      // After moving on with the reader's arrows, come back to the article it ended on.
      const session = useReaderSession.getState();
      if (session.origin === 'timeline' && session.lastId != null) {
        const target = session.lastId;
        useReaderSession.setState({ origin: null, lastId: null });
        const index = rowsRef.current.findIndex((r) => r.type === 'article' && r.item.id === target);
        if (target !== openedIdRef.current && index >= 0) {
          listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0.35 });
        }
      }
      // Back from one feed or Saved returns to All articles before leaving the app.
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (selectionRef.current.kind === 'all') return false;
        setSelection({ kind: 'all' });
        return true;
      });
      return () => sub.remove();
    }, []),
  );

  // A floating button back to the top: shown when scrolling up from far down, or
  // when a refresh brought new articles while the top was out of view.
  const scrollRef = useRef({ y: 0, away: false, up: false });
  const [scrollFlags, setScrollFlags] = useState({ away: false, up: false });
  const [newAbove, setNewAbove] = useState(false);
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const s = scrollRef.current;
      const y = e.nativeEvent.contentOffset.y;
      const dy = y - s.y;
      s.y = y;
      const away = y > screenHeight * 1.5;
      const up = dy < -8 ? true : dy > 8 ? false : s.up;
      if (away === s.away && up === s.up) return;
      s.away = away;
      s.up = up;
      setScrollFlags({ away, up });
      if (!away) setNewAbove(false);
    },
    [screenHeight],
  );
  useEffect(
    () =>
      useRefreshStore.subscribe((state, prev) => {
        if (state.lastSummary === prev.lastSummary || !state.lastSummary?.newArticles) return;
        // Only All articles is sure to list them.
        if (scrollRef.current.away && selectionRef.current.kind === 'all') setNewAbove(true);
      }),
    [],
  );
  // A different view gets a fresh list, so it starts at its top. It is swapped in
  // once the view's rows arrive: scrolling the old list instead was undone by its
  // anchoring, or left a blank gap under a stale day header. The timer covers a view
  // whose rows are identical, where no new data ever arrives.
  const [listKey, setListKey] = useState(filterKey);
  const shownKey = useRef(filterKey);
  const viewPending = useRef<{ key: string; from: typeof latest; timer: ReturnType<typeof setTimeout> } | null>(null);
  const showView = useCallback(() => {
    const pending = viewPending.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    viewPending.current = null;
    scrollRef.current = { y: 0, away: false, up: false };
    setScrollFlags({ away: false, up: false });
    setNewAbove(false);
    setListKey(pending.key);
  }, []);
  useEffect(() => {
    if (shownKey.current === filterKey) return;
    shownKey.current = filterKey;
    if (viewPending.current) clearTimeout(viewPending.current.timer);
    viewPending.current = { key: filterKey, from: latest, timer: setTimeout(showView, 800) };
    // Only a change of view starts this; `latest` is read as the rows it replaces.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, showView]);
  useEffect(() => {
    if (viewPending.current && latest !== viewPending.current.from) showView();
  }, [latest, showView]);
  useEffect(() => () => {
    if (viewPending.current) clearTimeout(viewPending.current.timer);
  }, []);
  const scrollToTop = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    setNewAbove(false);
  }, []);
  const showTopButton = scrollFlags.away && (scrollFlags.up || newAbove);

  const doRefresh = useCallback(async () => {
    if (!feeds?.length) {
      router.push('/feeds/add');
      return;
    }
    const summary = await refreshFeeds();
    if (!summary) return; // a refresh was already running
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    if (summary.failedFeeds) {
      showToast(
        `${summary.newArticles ? `${summary.newArticles} new · ` : ''}${summary.failedFeeds} ${summary.failedFeeds === 1 ? 'feed' : 'feeds'} failed`,
        { action: { label: 'View', onPress: () => router.push('/feeds') } },
      );
    } else {
      showToast(
        summary.newArticles
          ? `${summary.newArticles} new ${summary.newArticles === 1 ? 'article' : 'articles'}`
          : 'You’re up to date',
      );
    }
  }, [feeds, router]);

  // Read through a ref so the callback, and with it every memoized row, stays stable.
  const articlesRef = useRef(articles);
  useEffect(() => {
    articlesRef.current = articles;
  }, [articles]);
  const openArticle = useCallback(
    (item: ArticleListItem) => {
      // The reader's arrows move through a window of the list around the tapped article.
      const ids = (articlesRef.current ?? []).map((a) => a.id);
      const at = Math.max(0, ids.indexOf(item.id));
      openedIdRef.current = item.id;
      useReaderSession.setState({ ids: ids.slice(Math.max(0, at - 100), at + 100), origin: 'timeline', lastId: item.id });
      router.push({ pathname: '/article/[id]', params: { id: String(item.id) } });
    },
    [router],
  );

  const doMarkAll = useCallback(
    async (beforeTs?: number) => {
      const ids = await markAllRead(filter, beforeTs);
      if (!ids.length) {
        showToast('Nothing unread here');
        return;
      }
      clearKeptRead();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      showToast(`Marked ${ids.length} as read`, { action: { label: 'Undo', onPress: () => markUnread(ids) } });
    },
    [filter],
  );

  const openContext = useCallback((item: ArticleListItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setContextItem(item);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: Row }) => {
      if (item.type === 'day') return <DayHeader label={item.label} />;
      return (
        <ArticleRow item={item.item} variant={listStyle} onPress={openArticle} onLongPress={openContext} showFeed={selection.kind !== 'feed'} />
      );
    },
    [listStyle, openArticle, openContext, selection.kind],
  );

  const menuActions: SheetAction[] = [
    { label: 'Add a feed', icon: Plus, onPress: () => router.push('/feeds/add') },
    ...(selection.kind === 'saved'
      ? []
      : [{ label: hideRead ? 'Show read articles' : 'Hide read articles', icon: hideRead ? Eye : EyeOff, onPress: () => setSettings({ hideRead: !hideRead }) }]),
    { label: 'Mark all as read', icon: CheckCheck, onPress: () => doMarkAll() },
    { label: 'Manage feeds', icon: Rss, onPress: () => router.push('/feeds') },
    { label: 'Settings', icon: Settings, onPress: () => router.push('/settings') },
  ];

  const contextActions: SheetAction[] = contextItem
    ? [
        {
          label: contextItem.is_read ? 'Mark as unread' : 'Mark as read',
          icon: contextItem.is_read ? CircleDot : CheckCheck,
          onPress: () => setRead([contextItem.id], !contextItem.is_read),
        },
        {
          label: contextItem.is_saved ? 'Remove from Saved' : 'Save for later',
          icon: contextItem.is_saved ? BookmarkMinus : Bookmark,
          onPress: () => setSaved(contextItem.id, !contextItem.is_saved),
        },
        { label: 'Share', icon: Share2, onPress: () => shareArticle(contextItem.title, contextItem.url) },
        { label: 'Open original', icon: ExternalLink, onPress: () => openInBrowser(contextItem.url) },
        // Saved is ordered by when things were saved, so "older" has no clear meaning there.
        ...(selection.kind === 'saved'
          ? []
          : [{ label: 'Mark this and older as read', icon: ListChecks, onPress: () => doMarkAll(contextItem.published_at) }]),
      ]
    : [];

  const unread = selection.kind === 'feed' ? (selectedFeed?.unread ?? 0) : totalUnread;
  const status =
    selection.kind === 'saved'
      ? `${savedCounts?.total ?? 0} saved`
      : `${unread === 0 ? 'No' : unread} unread · updated ${agoLabel(lastRefreshAt)}`;
  const subtitle = running
    ? `Checking feeds · ${refreshDone} of ${refreshTotal}`
    : pendingOffline > 0
      ? `Saving ${pendingOffline} ${pendingOffline === 1 ? 'article' : 'articles'} for offline`
      : status;

  const noFeeds = feeds !== undefined && feeds.length === 0;
  const progress = running ? (refreshTotal ? refreshDone / refreshTotal : 0) : null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <View style={{ paddingTop: insets.top + 6, backgroundColor: theme.colors.bg }}>
        <View style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingLeft: theme.space.gutter, paddingRight: 8 }}>
          <Pressable
            onPress={() => setPickerOpen(true)}
            pressScale={1}
            accessibilityRole="button"
            accessibilityLabel={`${title}. Change feed`}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, marginRight: 4 }}
            disabled={noFeeds}
          >
            <Text variant="display" numberOfLines={1} style={{ flexShrink: 1 }}>
              {noFeeds ? 'Feedline' : title}
            </Text>
            {!noFeeds ? <ChevronDown size={20} color={theme.colors.inkTertiary} strokeWidth={2} style={{ marginTop: 5 }} /> : null}
          </Pressable>
          <IconButton icon={Search} label="Search" onPress={() => router.push('/search')} disabled={noFeeds} />
          <RefreshButton spinning={running} onPress={doRefresh} />
          <IconButton icon={MoreVertical} label="More" onPress={() => setMenuOpen(true)} />
        </View>
        {!noFeeds ? (
          <Text variant="meta" tone="tertiary" numberOfLines={1} style={{ paddingHorizontal: theme.space.gutter, paddingBottom: 12 }}>
            {subtitle}
          </Text>
        ) : (
          <View style={{ height: 8 }} />
        )}
        <ProgressBar progress={progress} active={running || pendingOffline > 0} />
      </View>

      {noFeeds ? (
        <EmptyState
          title="A quiet place to read"
          body="Follow the sites you love. Articles are saved on this phone, so you can read them anywhere, even offline."
        >
          <Button label="Add a feed" icon={Plus} onPress={() => router.push('/feeds/add')} />
          <Button label="Import OPML" icon={FileUp} kind="secondary" onPress={() => router.push('/settings/opml-import')} />
        </EmptyState>
      ) : (
        <View style={{ flex: 1 }}>
          <FlashList
            key={listKey}
            ref={listRef}
            data={rows}
            renderItem={renderItem}
            keyExtractor={(r) => r.key}
            getItemType={(r) => (r.type === 'day' ? 'day' : listStyle)}
            stickyHeaderIndices={stickyIndices}
            onEndReached={() => {
              if ((articles?.length ?? 0) >= limit) setPage({ key: filterKey, limit: limit + PAGE });
            }}
            onEndReachedThreshold={0.6}
            drawDistance={600}
            onScrollBeginDrag={holdRows}
            // A drag that ends without a fling settles right away; a fling settles at its end.
            onScrollEndDrag={() => releaseRows(250)}
            onMomentumScrollBegin={holdRows}
            onMomentumScrollEnd={() => releaseRows(0)}
            onScroll={onScroll}
            contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
            ListEmptyComponent={
              loading ? null : (
                <EmptyState
                  mark={selection.kind === 'saved' ? '☆' : '❦'}
                  title={selection.kind === 'saved' ? 'Nothing saved yet' : hideRead ? 'You’re all caught up' : 'No articles yet'}
                  body={
                    selection.kind === 'saved'
                      ? 'Long-press an article, or tap the bookmark while reading, to keep it here. Saved articles are never cleaned up.'
                      : hideRead
                        ? 'Every article here has been read.'
                        : 'Tap Refresh to check for new articles.'
                  }
                >
                  {selection.kind === 'saved' ? null : hideRead ? (
                    <Button label="Show read articles" kind="secondary" onPress={() => setSettings({ hideRead: false })} />
                  ) : (
                    <Button label="Refresh" icon={RotateCw} kind="secondary" loading={running} onPress={doRefresh} />
                  )}
                </EmptyState>
              )
            }
          />
          {showTopButton ? (
            <Animated.View
              entering={FadeIn.duration(160)}
              exiting={FadeOut.duration(160)}
              style={{ position: 'absolute', top: DAY_HEADER_HEIGHT + 8, alignSelf: 'center' }}
            >
              <Pressable
                onPress={scrollToTop}
                accessibilityRole="button"
                accessibilityLabel={newAbove ? 'New articles. Scroll to top' : 'Back to top'}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  height: 36,
                  paddingHorizontal: 14,
                  borderRadius: 18,
                  backgroundColor: theme.colors.ink,
                  shadowColor: '#000',
                  shadowOpacity: 0.18,
                  shadowRadius: 12,
                  shadowOffset: { width: 0, height: 4 },
                  elevation: 4,
                }}
              >
                <ArrowUp size={16} color={theme.colors.bg} strokeWidth={2} />
                <Text variant="metaStrong" style={{ color: theme.colors.bg }}>
                  {newAbove ? 'New articles' : 'Back to top'}
                </Text>
              </Pressable>
            </Animated.View>
          ) : null}
        </View>
      )}

      <FeedPickerSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        feeds={feeds ?? []}
        totalUnread={totalUnread}
        savedCount={savedCounts?.total ?? 0}
        selection={selection}
        onSelect={setSelection}
      />
      <ActionSheet visible={menuOpen} onClose={() => setMenuOpen(false)} actions={menuActions} />
      <ActionSheet
        visible={!!contextItem}
        onClose={() => setContextItem(null)}
        title={contextItem?.title}
        subtitle={contextItem?.feed_name}
        actions={contextActions}
      />
    </View>
  );
}

function RefreshButton({ spinning, onPress }: { spinning: boolean; onPress: () => void }) {
  const rotation = useSharedValue(0);
  useEffect(() => {
    if (spinning) {
      rotation.set(0);
      rotation.set(withRepeat(withTiming(360, { duration: 900, easing: Easing.linear }), -1, false));
    } else {
      cancelAnimation(rotation);
      rotation.set(withTiming(0, { duration: 200 }));
    }
  }, [spinning, rotation]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }));
  return (
    <Animated.View style={style}>
      <IconButton icon={RotateCw} label="Refresh" onPress={onPress} disabled={spinning} />
    </Animated.View>
  );
}
