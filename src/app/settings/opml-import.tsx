import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { Check, FileUp } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Divider } from '@/components/Misc';
import { Pressable } from '@/components/Pressable';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Text } from '@/components/Text';
import { showToast, useToastLift } from '@/components/Toast';
import { feedUrlSet, insertFeeds } from '@/db/feeds';
import { refreshFeeds } from '@/feeds/refresh';
import { hostOf } from '@/lib/url';
import { pickOpml } from '@/opml/io';
import type { OpmlFeed } from '@/opml/opml';
import { useTheme } from '@/theme';

type Item = OpmlFeed & { existing: boolean };

export default function OpmlImport() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Item[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const opened = useRef(false);
  // Toasts clear the pinned Import button.
  useToastLift(items ? 62 : 0);

  const pick = async () => {
    setError(null);
    try {
      const feeds = await pickOpml();
      if (!feeds) return;
      if (!feeds.length) {
        setError('That file doesn’t contain any feeds.');
        return;
      }
      const existing = await feedUrlSet();
      const list = feeds.map((f) => ({ ...f, existing: existing.has(f.url) }));
      setItems(list);
      setSelected(new Set(list.filter((f) => !f.existing).map((f) => f.url)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file');
    }
  };

  // Open the picker straight away; the screen is only reached to import.
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    pick();
  }, []);

  const toggle = (url: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });

  const fresh = items?.filter((i) => !i.existing) ?? [];
  const allSelected = fresh.length > 0 && fresh.every((i) => selected.has(i.url));

  const doImport = async () => {
    if (!items) return;
    setImporting(true);
    try {
      const chosen = items.filter((i) => !i.existing && selected.has(i.url));
      const ids = await insertFeeds(chosen);
      showToast(`Imported ${ids.length} ${ids.length === 1 ? 'feed' : 'feeds'} · fetching articles`);
      router.dismissTo('/');
      // Queued automatically if a refresh is already running.
      refreshFeeds(ids).catch(() => {});
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Import failed');
      setImporting(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScreenHeader
        title="Import OPML"
        subtitle={items ? `${items.length} feeds in file · ${items.length - fresh.length} already subscribed` : undefined}
        right={
          items && fresh.length ? (
            <Pressable
              onPress={() => setSelected(allSelected ? new Set() : new Set(fresh.map((f) => f.url)))}
              accessibilityRole="button"
              hitSlop={8}
              style={{ paddingHorizontal: 14, paddingVertical: 10 }}
            >
              <Text variant="metaStrong" tone="accent">
                {allSelected ? 'Select none' : 'Select all'}
              </Text>
            </Pressable>
          ) : null
        }
      />
      {!items ? (
        <EmptyState title="Bring your feeds along" body={error ?? 'Choose an .opml file exported from another feed reader. Folders are flattened.'}>
          <Button label="Choose file" icon={FileUp} onPress={pick} />
        </EmptyState>
      ) : (
        <>
          <FlashList
            data={items}
            keyExtractor={(i) => i.url}
            ItemSeparatorComponent={() => <Divider inset={theme.space.gutter + 38} />}
            contentContainerStyle={{ paddingBottom: 120 }}
            renderItem={({ item }) => {
              const on = item.existing || selected.has(item.url);
              return (
                <Pressable
                  onPress={() => !item.existing && toggle(item.url)}
                  disabled={item.existing}
                  pressScale={1}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on, disabled: item.existing }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: theme.space.gutter, paddingVertical: 13 }}
                >
                  <View
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 6,
                      borderWidth: 1.5,
                      borderColor: on ? theme.colors.ink : theme.colors.inkTertiary,
                      backgroundColor: on ? theme.colors.ink : 'transparent',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {on ? <Check size={14} color={theme.colors.bg} strokeWidth={3} /> : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="body" numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text variant="meta" tone="tertiary" numberOfLines={1}>
                      {item.existing ? 'Already subscribed' : hostOf(item.url)}
                    </Text>
                  </View>
                </Pressable>
              );
            }}
          />
          <View
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              paddingHorizontal: theme.space.gutter,
              paddingTop: 12,
              paddingBottom: insets.bottom + 12,
              backgroundColor: theme.colors.bg,
              borderTopWidth: 1,
              borderTopColor: theme.colors.hairline,
            }}
          >
            <Button
              label={selected.size ? `Import ${selected.size} ${selected.size === 1 ? 'feed' : 'feeds'}` : 'Nothing selected'}
              disabled={!selected.size}
              loading={importing}
              onPress={doImport}
            />
          </View>
        </>
      )}
    </View>
  );
}
