import { Paths } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Bookmark, CheckCheck, ChevronLeft, ChevronRight, CircleDot, ExternalLink, Share2, Type } from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/IconButton';
import { ReaderSettingsSheet } from '@/components/ReaderSettingsSheet';
import { Text } from '@/components/Text';
import { showToast, useToastLift } from '@/components/Toast';
import { getArticle, setRead, setSaved } from '@/db/articles';
import type { ArticleFull } from '@/db/types';
import { useQuery } from '@/db/useQuery';
import { imageDownloadsAllowed } from '@/feeds/images';
import { makeOffline } from '@/feeds/refresh';
import { openInBrowser, shareArticle } from '@/lib/articleActions';
import { WebView, type WebViewHandle, type WebViewMessageEvent } from '@/lib/webview';
import { readerHtml, type ReaderMessage } from '@/reader/template';
import { useReaderSession } from '@/state/readerSession';
import { useSettings } from '@/state/settings';
import { useTheme } from '@/theme';

const BAR = 52;

export default function ReaderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const initialId = Number(id);

  // Snapshot the list order once; the list behind us may change while reading.
  const ids = useMemo(() => {
    const session = useReaderSession.getState().ids;
    return session.includes(initialId) ? session : [initialId];
  }, [initialId]);
  const [index, setIndex] = useState(() => Math.max(0, ids.indexOf(initialId)));
  const [aaOpen, setAaOpen] = useState(false);
  // Keep toasts clear of the floating toolbar (it sits 12px up and is BAR tall).
  useToastLift(BAR);
  const currentId = ids[index]!;
  useEffect(() => {
    useReaderSession.setState({ lastId: currentId });
  }, [currentId]);
  const hasPrev = index > 0;
  const hasNext = index < ids.length - 1;

  const { data: article } = useQuery(() => getArticle(currentId), [currentId], ['articles']);

  // Chrome visibility: hidden while scrolling down, back on scroll up or at the end.
  const chrome = useSharedValue(1);
  const titleShown = useSharedValue(0);
  const progress = useSharedValue(0);
  const scrollState = useRef({ lastY: 0, titleBottom: 120 });

  useEffect(() => {
    chrome.set(withTiming(1, { duration: 180 }));
    titleShown.set(0);
    progress.set(0);
    scrollState.current = { lastY: 0, titleBottom: 120 };
  }, [index, chrome, titleShown, progress]);

  const onMessage = useCallback(
    (msg: ReaderMessage) => {
      if (msg.type === 'meta') scrollState.current.titleBottom = msg.titleBottom;
      else if (msg.type === 'scroll') {
        const s = scrollState.current;
        const dy = msg.y - s.lastY;
        const atEnd = msg.max > 0 && msg.y >= msg.max - 48;
        if (atEnd || msg.y < 40 || dy < -10) chrome.set(withTiming(1, { duration: 180 }));
        else if (dy > 10) chrome.set(withTiming(0, { duration: 220 }));
        if (Math.abs(dy) > 10 || atEnd) s.lastY = msg.y;
        titleShown.set(withTiming(msg.y > s.titleBottom - 20 ? 1 : 0, { duration: 160 }));
        progress.set(msg.max > 0 ? Math.min(1, msg.y / msg.max) : 0);
      }
    },
    [chrome, titleShown, progress],
  );

  const topStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (chrome.value - 1) * (BAR + insets.top) }],
  }));
  const bottomStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - chrome.value) * (BAR + insets.bottom + 16) }],
  }));
  const titleStyle = useAnimatedStyle(() => ({ opacity: titleShown.value }));
  const progressStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  const toggleSaved = () => {
    if (!article) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setSaved(article.id, !article.is_saved);
    showToast(article.is_saved ? 'Removed from Saved' : 'Saved for later');
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      {/* One article at a time: a swipe pager stole vertical scrolls that drifted
          sideways. The toolbar's arrows move between articles instead. */}
      <ReaderPage key={currentId} articleId={currentId} topInset={insets.top + BAR} onMessage={onMessage} />

      <Animated.View style={[styles.top, { paddingTop: insets.top, backgroundColor: theme.colors.bg, borderBottomColor: theme.colors.hairline }, topStyle]}>
        <View style={styles.bar}>
          <IconButton icon={ArrowLeft} label="Back" onPress={() => router.back()} />
          <Animated.View style={[{ flex: 1, marginHorizontal: 4 }, titleStyle]}>
            <Text variant="metaStrong" tone="secondary" numberOfLines={1}>
              {article?.feed_name}
            </Text>
            <Text variant="meta" tone="tertiary" numberOfLines={1}>
              {article?.title}
            </Text>
          </Animated.View>
        </View>
        <View style={{ height: 2 }}>
          <Animated.View style={[{ height: 2, backgroundColor: theme.colors.accent }, progressStyle]} />
        </View>
      </Animated.View>

      <Animated.View
        style={[
          styles.bottom,
          {
            bottom: insets.bottom + 12,
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.hairline,
          },
          bottomStyle,
        ]}
      >
        <IconButton
          icon={ChevronLeft}
          label="Previous article"
          onPress={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={!hasPrev}
          style={!hasPrev && styles.off}
        />
        <View style={[styles.divider, { backgroundColor: theme.colors.hairline }]} />
        <IconButton
          icon={Bookmark}
          label={article?.is_saved ? 'Remove from Saved' : 'Save'}
          filled={!!article?.is_saved}
          color={article?.is_saved ? theme.colors.accent : theme.colors.ink}
          onPress={toggleSaved}
        />
        <IconButton icon={Type} label="Text settings" onPress={() => setAaOpen(true)} />
        <IconButton icon={Share2} label="Share" onPress={() => article && shareArticle(article.title, article.url)} />
        <IconButton icon={ExternalLink} label="Open original" onPress={() => openInBrowser(article?.url ?? null)} disabled={!article?.url} />
        <IconButton
          icon={article?.is_read ? CircleDot : CheckCheck}
          label={article?.is_read ? 'Mark as unread' : 'Mark as read'}
          onPress={() => {
            if (!article) return;
            setRead([article.id], !article.is_read);
            showToast(article.is_read ? 'Marked as unread' : 'Marked as read');
          }}
        />
        <View style={[styles.divider, { backgroundColor: theme.colors.hairline }]} />
        <IconButton
          icon={ChevronRight}
          label="Next article"
          onPress={() => setIndex((i) => Math.min(ids.length - 1, i + 1))}
          disabled={!hasNext}
          style={!hasNext && styles.off}
        />
      </Animated.View>

      <ReaderSettingsSheet visible={aaOpen} onClose={() => setAaOpen(false)} />
    </View>
  );
}

type PageProps = {
  articleId: number;
  topInset: number;
  onMessage: (msg: ReaderMessage) => void;
};

const ReaderPage = memo(function ReaderPage({ articleId, topInset, onMessage }: PageProps) {
  const theme = useTheme();
  const ref = useRef<WebViewHandle>(null);
  const size = useSettings((s) => s.readerSize);
  const lineHeight = useSettings((s) => s.readerLineHeight);
  const family = useSettings((s) => s.readerFamily);
  const [article, setArticle] = useState<ArticleFull | null | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const [fetching, setFetching] = useState(false);
  const markedRead = useRef(false);
  const autoFetched = useRef(false);

  // Load once. Later background updates (images finishing) must not reload the
  // page under the reader's finger; local and remote images both work.
  useEffect(() => {
    let cancelled = false;
    getArticle(articleId).then((a) => {
      if (!cancelled) setArticle(a);
    });
    return () => {
      cancelled = true;
    };
  }, [articleId]);

  useEffect(() => {
    if (article && !article.is_read && !markedRead.current) {
      markedRead.current = true;
      setRead([article.id], true);
    }
  }, [article]);

  const fetchFull = useCallback(
    async (fromUser: boolean) => {
      const imagesAllowed = await imageDownloadsAllowed();
      setFetching(true);
      await makeOffline(articleId, imagesAllowed, { forceFullText: true, priority: true });
      const updated = await getArticle(articleId);
      // One state update swaps the notice for the full text in a single reload.
      setArticle(updated);
      setFetching(false);
      if (fromUser && updated?.content_status === 'feed') showToast('This is already the whole article');
      else if (fromUser && updated?.content_status !== 'full') showToast('Couldn’t get the full article. Try “Open original”.');
    },
    [articleId],
  );

  // A truncated article fetches its full text as soon as it is opened, ahead of
  // the background queue.
  useEffect(() => {
    if (!article || autoFetched.current || !article.url) return;
    if (article.content_status !== 'lazy' && article.content_status !== 'pending') return;
    const timer = setTimeout(() => {
      autoFetched.current = true;
      fetchFull(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [article, fetchFull]);

  const html = useMemo(() => {
    if (!article) return null;
    const notice = fetching
      ? { text: 'Getting the full article…', action: null, busy: true }
      : article.content_status === 'failed' && article.url
        ? { text: 'Showing the feed’s summary', action: 'Try again' }
        : null;
    return readerHtml(
      {
        title: article.title,
        url: article.url,
        author: article.author,
        feedName: article.feed_name,
        feedIcon: article.feed_icon,
        publishedAt: article.published_at,
        readingMinutes: article.reading_minutes,
        contentHtml: article.content_html ?? '',
        notice,
      },
      theme,
      // Read at build time only: later changes are applied live via __setPrefs.
      (({ readerSize, readerLineHeight, readerFamily }) => ({
        size: readerSize,
        lineHeight: readerLineHeight,
        family: readerFamily,
      }))(useSettings.getState()),
      topInset,
    );
  }, [article, fetching, theme, topInset]);

  // Apply typography changes live without reloading.
  useEffect(() => {
    if (!loaded) return;
    ref.current?.injectJavaScript(`window.__setPrefs(${JSON.stringify({ size, lineHeight, family })}); true;`);
  }, [size, lineHeight, family, loaded]);

  const loadFull = useCallback(() => {
    if (!fetching) fetchFull(true);
  }, [fetching, fetchFull]);

  // Never leave the cover up if the WebView fails to report a load.
  useEffect(() => {
    if (loaded) return;
    const timer = setTimeout(() => setLoaded(true), 6000);
    return () => clearTimeout(timer);
  }, [loaded]);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let msg: ReaderMessage;
      try {
        msg = JSON.parse(event.nativeEvent.data) as ReaderMessage;
      } catch {
        return;
      }
      if (msg.type === 'notice') loadFull();
      else onMessage(msg);
    },
    [onMessage, loadFull],
  );

  // Article images are stored relative to the documents directory; the base must
  // end in "/" or relative URLs would resolve against its parent.
  const docUri = Paths.document.uri;
  const baseUrl = docUri.endsWith('/') ? docUri : `${docUri}/`;

  if (article === null) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
        <Text variant="title">This article is gone</Text>
        <Text variant="body" tone="secondary" style={{ marginTop: 8, textAlign: 'center', alignSelf: 'stretch' }}>
          It may have been cleaned up or its feed was removed.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      {html ? (
        <WebView
          ref={ref}
          source={{ html, baseUrl }}
          originWhitelist={['*']}
          style={{ flex: 1, backgroundColor: theme.colors.bg }}
          containerStyle={{ backgroundColor: theme.colors.bg }}
          onMessage={handleMessage}
          onLoadEnd={() => setLoaded(true)}
          onShouldStartLoadWithRequest={(req) => {
            const url = req.url;
            if (url.startsWith(baseUrl) || url.startsWith('about:') || url.startsWith('data:')) return true;
            if (req.isTopFrame === false) return false;
            openInBrowser(url);
            return false;
          }}
          javaScriptEnabled
          allowFileAccess
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          setSupportMultipleWindows={false}
          mixedContentMode="always"
          textZoom={100}
          overScrollMode="never"
          showsVerticalScrollIndicator={false}
          setBuiltInZoomControls={false}
          cacheEnabled
          webviewDebuggingEnabled={__DEV__}
        />
      ) : null}
      {!loaded ? (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.bg, paddingTop: topInset + 80, alignItems: 'center' }]}
        >
          <ActivityIndicator color={theme.colors.inkTertiary} />
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  top: { position: 'absolute', top: 0, left: 0, right: 0, borderBottomWidth: StyleSheet.hairlineWidth },
  bar: { height: BAR, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 },
  bottom: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 10,
    height: BAR,
    alignItems: 'center',
    borderRadius: 26,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  divider: { width: StyleSheet.hairlineWidth, height: 24, marginHorizontal: 2 },
  off: { opacity: 0.3 },
});
