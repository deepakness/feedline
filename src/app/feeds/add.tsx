import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ClipboardPaste, FileUp, Search } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { FeedIcon } from '@/components/FeedIcon';
import { Pressable } from '@/components/Pressable';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Text } from '@/components/Text';
import { showToast } from '@/components/Toast';
import { findFeedByUrl, insertFeed } from '@/db/feeds';
import { discoverFeeds, type FeedCandidate } from '@/feeds/discover';
import { refreshOne } from '@/feeds/refresh';
import { extractUrl, hostOf } from '@/lib/url';
import { useTheme } from '@/theme';

export default function AddFeed() {
  const params = useLocalSearchParams<{ url?: string }>();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [input, setInput] = useState(params.url ?? '');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<FeedCandidate[] | null>(null);
  const [subscribing, setSubscribing] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState<Set<string>>(new Set());
  const autoRan = useRef(false);

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  const find = useCallback(async (value: string) => {
    if (!value.trim()) return;
    setSearching(true);
    setError(null);
    setCandidates(null);
    try {
      const found = await discoverFeeds(value);
      const existing = new Set<string>();
      for (const c of found) if (await findFeedByUrl(c.url)) existing.add(c.url);
      setSubscribed(existing);
      setCandidates(found);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setSearching(false);
    }
  }, []);

  // Arriving from the share sheet: look up the shared link right away.
  useEffect(() => {
    if (params.url && !autoRan.current) {
      autoRan.current = true;
      setInput(params.url);
      find(params.url);
    }
  }, [params.url, find]);

  const paste = async () => {
    const text = await Clipboard.getStringAsync().catch(() => '');
    const url = extractUrl(text) ?? text.trim();
    if (!url) {
      showToast('Clipboard is empty');
      return;
    }
    setInput(url);
    find(url);
  };

  const subscribe = async (c: FeedCandidate) => {
    setSubscribing(c.url);
    try {
      const id = await insertFeed({ url: c.url, title: c.title, siteUrl: c.siteUrl });
      setSubscribed((s) => new Set(s).add(c.url));
      const result = await refreshOne(id);
      showToast(
        result.error
          ? `Subscribed, but the first refresh failed: ${result.error}`
          : `Subscribed to ${c.title}${result.added ? ` · ${result.added} articles` : ''}`,
      );
      if ((candidates?.length ?? 0) <= 1) close();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not subscribe');
    } finally {
      setSubscribing(null);
    }
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScreenHeader title="Add a feed" subtitle="Paste a website or feed address" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: theme.space.gutter, paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            height: 52,
            borderRadius: theme.radius.md,
            borderWidth: 1,
            borderColor: error ? theme.colors.danger : theme.colors.hairline,
            backgroundColor: theme.colors.surface,
            paddingLeft: 14,
          }}
        >
          <TextInput
            value={input}
            onChangeText={(t) => {
              setInput(t);
              setError(null);
            }}
            onSubmitEditing={() => find(input)}
            autoFocus={!params.url}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="search"
            placeholder="theverge.com"
            placeholderTextColor={theme.colors.inkTertiary}
            selectionColor={theme.colors.accent}
            style={[theme.type.body, { flex: 1, color: theme.colors.ink, paddingVertical: 0 }]}
            accessibilityLabel="Website or feed address"
          />
          {!input ? (
            <Pressable onPress={paste} accessibilityRole="button" accessibilityLabel="Paste" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: '100%' }}>
              <ClipboardPaste size={16} color={theme.colors.accent} strokeWidth={2} />
              <Text variant="metaStrong" tone="accent">
                Paste
              </Text>
            </Pressable>
          ) : null}
        </View>
        {error ? (
          <Text variant="callout" tone="danger" style={{ marginTop: 10 }}>
            {error}
          </Text>
        ) : null}

        <Button label="Find feed" icon={Search} onPress={() => find(input)} loading={searching} disabled={!input.trim()} style={{ marginTop: 14 }} />

        {searching ? (
          <View style={{ alignItems: 'center', paddingTop: 36, gap: 12 }}>
            <ActivityIndicator color={theme.colors.inkTertiary} />
            <Text variant="meta" tone="tertiary">
              Looking for feeds on {hostOf(extractUrl(input) ?? `https://${input.trim()}`) || 'that site'}…
            </Text>
          </View>
        ) : null}

        {candidates?.length ? (
          <View style={{ marginTop: 28, gap: 12 }}>
            <Text variant="section" tone="tertiary">
              {candidates.length === 1 ? 'Found a feed' : `Found ${candidates.length} feeds`}
            </Text>
            {candidates.map((c) => {
              const already = subscribed.has(c.url);
              return (
                <View
                  key={c.url}
                  style={{ borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.hairline, backgroundColor: theme.colors.surface, padding: 16 }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <FeedIcon name={c.title} uri={c.iconUrl} size={32} />
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyStrong" numberOfLines={2}>
                        {c.title}
                      </Text>
                      <Text variant="meta" tone="tertiary" numberOfLines={1}>
                        {hostOf(c.url)} · {c.itemCount} {c.itemCount === 1 ? 'article' : 'articles'}
                      </Text>
                    </View>
                  </View>
                  {c.latestTitles.length ? (
                    <View style={{ marginTop: 12, gap: 6 }}>
                      {c.latestTitles.map((t, i) => (
                        <Text key={i} variant="callout" tone="secondary" numberOfLines={1}>
                          {t}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                  <Button
                    label={already ? 'Subscribed' : 'Subscribe'}
                    kind={already ? 'secondary' : 'primary'}
                    disabled={already}
                    loading={subscribing === c.url}
                    onPress={() => subscribe(c)}
                    style={{ marginTop: 14, height: 44 }}
                  />
                </View>
              );
            })}
          </View>
        ) : null}

        {!candidates && !searching ? (
          <View style={{ marginTop: 40, gap: 10 }}>
            <Text variant="callout" tone="tertiary">
              Tip: you can also share a link to Feedline from Chrome, or bring your subscriptions from another reader.
            </Text>
            <Button label="Import OPML" icon={FileUp} kind="plain" onPress={() => router.push('/settings/opml-import')} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} />
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
