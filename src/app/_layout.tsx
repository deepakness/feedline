// Per-weight imports: the package index would bundle every weight.
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Newsreader_500Medium } from '@expo-google-fonts/newsreader/500Medium';
import { Newsreader_600SemiBold } from '@expo-google-fonts/newsreader/600SemiBold';
import { useFonts } from 'expo-font';
import { Stack, useRouter } from 'expo-router';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useState } from 'react';
import { AppState, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Text } from '@/components/Text';
import { ToastHost, showToast } from '@/components/Toast';
import { getDb } from '@/db/client';
import { listFeeds } from '@/db/feeds';
import { ExtractorHost } from '@/extract/ExtractorHost';
import { processPendingArticles, refreshFeeds } from '@/feeds/refresh';
import { extractUrl } from '@/lib/url';
import { useRefreshStore } from '@/state/refreshStore';
import { REFRESH_ON_OPEN_AFTER_MS, settings } from '@/state/settings';
import { ThemeProvider, useTheme } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  return (
    <ShareIntentProvider options={{ resetOnBackground: true }}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <ThemeProvider>
            <App />
          </ThemeProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ShareIntentProvider>
  );
}

function App() {
  const theme = useTheme();
  const [fontsLoaded] = useFonts({
    Newsreader_500Medium,
    Newsreader_600SemiBold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });
  const [dbError, setDbError] = useState<string | null>(null);
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(theme.colors.bg).catch(() => {});
  }, [theme]);

  useEffect(() => {
    getDb().then(
      () => setDbReady(true),
      (e) => setDbError(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  const ready = fontsLoaded && dbReady;
  useEffect(() => {
    if (ready || dbError) SplashScreen.hideAsync().catch(() => {});
  }, [ready, dbError]);

  if (dbError) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.bg, justifyContent: 'center', padding: 32 }}>
        <Text variant="title">Couldn’t open your library</Text>
        <Text variant="body" tone="secondary" style={{ marginTop: 8 }}>
          {dbError}
        </Text>
      </View>
    );
  }
  if (!ready) return null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <StatusBar style={theme.scheme === 'light' ? 'dark' : 'light'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.bg },
          animation: 'slide_from_right',
          animationDuration: 260,
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="article/[id]" options={{ animation: 'fade_from_bottom' }} />
        <Stack.Screen name="search" options={{ animation: 'fade' }} />
        <Stack.Screen name="feeds/add" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      </Stack>
      <ExtractorHost />
      <ToastHost />
      <RefreshOnOpen />
      <ShareIntentRouter />
    </View>
  );
}

/** Refreshes on launch and on resume when the last refresh is older than an hour. */
function RefreshOnOpen() {
  useEffect(() => {
    const maybeRefresh = async () => {
      const s = settings.get();
      if (!s.refreshOnOpen || useRefreshStore.getState().running) return;
      if (Date.now() - s.lastRefreshAt < REFRESH_ON_OPEN_AFTER_MS) return;
      if (!(await listFeeds()).length) return;
      const summary = await refreshFeeds();
      if (summary?.newArticles) showToast(`${summary.newArticles} new ${summary.newArticles === 1 ? 'article' : 'articles'}`);
    };
    // Finish anything a previous session left half-downloaded, once the first
    // screen has had the JS thread to itself.
    const timer = setTimeout(() => {
      processPendingArticles().catch(() => {});
      maybeRefresh().catch(() => {});
    }, 1500);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') maybeRefresh().catch(() => {});
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, []);
  return null;
}

function ShareIntentRouter() {
  const router = useRouter();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  useEffect(() => {
    if (!hasShareIntent) return;
    const url = shareIntent.webUrl ?? extractUrl(shareIntent.text);
    resetShareIntent();
    if (url) router.navigate({ pathname: '/feeds/add', params: { url } });
    else showToast('That share didn’t include a link');
  }, [hasShareIntent, shareIntent, resetShareIntent, router]);
  return null;
}
