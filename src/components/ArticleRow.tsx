import { Image } from 'expo-image';
import { Bookmark } from 'lucide-react-native';
import { memo } from 'react';
import { Pressable, View, type PressableStateCallbackType } from 'react-native';

import type { ArticleListItem } from '@/db/types';
import { relativeTime } from '@/lib/time';
import type { ListStyle } from '@/state/settings';
import { useStyles, useTheme, type Theme } from '@/theme';

import { FeedIcon } from './FeedIcon';
import { Text } from './Text';

type Props = {
  item: ArticleListItem;
  variant: ListStyle;
  onPress: (item: ArticleListItem) => void;
  onLongPress: (item: ArticleListItem) => void;
  /** Hide the feed name when the list is already filtered to one feed. */
  showFeed: boolean;
};

function Meta({ item, showFeed }: { item: ArticleListItem; showFeed: boolean }) {
  const theme = useTheme();
  const unread = !item.is_read;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 18 }}>
      {showFeed ? <FeedIcon name={item.feed_name} uri={item.feed_icon} size={16} /> : null}
      {showFeed ? (
        <Text variant="metaStrong" tone="secondary" numberOfLines={1} style={{ flexShrink: 1 }}>
          {item.feed_name}
        </Text>
      ) : null}
      <Text variant="meta" tone="tertiary">
        {showFeed ? '· ' : ''}
        {relativeTime(item.published_at)}
      </Text>
      {item.is_saved ? <Bookmark size={12} color={theme.colors.accent} fill={theme.colors.accent} strokeWidth={2} /> : null}
      <View style={{ flex: 1 }} />
      {unread ? (
        <View
          accessibilityLabel="Unread"
          style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: theme.colors.accent }}
        />
      ) : null}
    </View>
  );
}

function ArticleRowImpl({ item, variant, onPress, onLongPress, showFeed }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const read = !!item.is_read;
  const titleColor = read ? theme.colors.inkSecondary : theme.colors.ink;
  const a11y = `${item.title}. ${item.feed_name}. ${read ? 'Read' : 'Unread'}${item.is_saved ? ', saved' : ''}`;

  // A plain native Pressable: rows carry no per-row animation or gesture state,
  // and the short press delay keeps the highlight from flashing when a drag that
  // starts on a row turns into a scroll.
  const press = {
    onPress: () => onPress(item),
    onLongPress: () => onLongPress(item),
    delayLongPress: 380,
    unstable_pressDelay: 70,
    accessibilityRole: 'button' as const,
    accessibilityLabel: a11y,
    accessibilityHint: 'Opens the article. Long press for more actions.',
  };
  const pressed = (base: object) => ({ pressed: isPressed }: PressableStateCallbackType) => [
    base,
    isPressed && { backgroundColor: theme.colors.surfaceSunken },
  ];

  if (variant === 'compact') {
    return (
      <Pressable {...press} style={pressed(styles.compact)}>
        <Meta item={item} showFeed={showFeed} />
        <Text variant="listTitleCompact" numberOfLines={2} style={[styles.compactTitle, { color: titleColor }]}>
          {item.title}
        </Text>
      </Pressable>
    );
  }

  if (variant === 'cards') {
    return (
      <Pressable {...press} style={styles.cardOuter}>
        {({ pressed: isPressed }) => (
        <View style={[styles.card, isPressed && { backgroundColor: theme.colors.surfaceSunken }]}>
          {item.thumb_path ? (
            <Image source={{ uri: item.thumb_path }} style={styles.cardImage} contentFit="cover" recyclingKey={String(item.id)} cachePolicy="memory-disk" />
          ) : null}
          <View style={styles.cardBody}>
            <Meta item={item} showFeed={showFeed} />
            <Text variant="title" numberOfLines={3} style={{ color: titleColor, marginTop: 8 }}>
              {item.title}
            </Text>
            {item.excerpt ? (
              <Text variant="callout" tone="secondary" numberOfLines={2} style={{ marginTop: 6 }}>
                {item.excerpt}
              </Text>
            ) : null}
          </View>
        </View>
        )}
      </Pressable>
    );
  }

  const thumb = item.thumb_path ? (
    <Image
      source={{ uri: item.thumb_path }}
      style={[styles.thumb, read && { opacity: 0.75 }]}
      contentFit="cover"
      recyclingKey={String(item.id)}
      cachePolicy="memory-disk"
    />
  ) : null;
  const title = (
    <Text variant="listTitle" numberOfLines={3} style={{ color: titleColor }}>
      {item.title}
    </Text>
  );

  // The title spans the full width; the thumbnail sits beside the excerpt below it.
  // Without an excerpt there is nothing to pair the image with, so it stays beside the title.
  return (
    <Pressable {...press} style={pressed(styles.standard)}>
      <Meta item={item} showFeed={showFeed} />
      {item.excerpt ? (
        <>
          <View style={styles.standardTitle}>{title}</View>
          <View style={styles.standardBody}>
            <Text
              variant="callout"
              tone={read ? 'tertiary' : 'secondary'}
              numberOfLines={thumb ? 3 : 2}
              style={styles.excerpt}
            >
              {item.excerpt}
            </Text>
            {thumb}
          </View>
        </>
      ) : (
        <View style={[styles.standardBody, styles.standardTitle]}>
          <View style={styles.excerpt}>{title}</View>
          {thumb}
        </View>
      )}
    </Pressable>
  );
}

export const ArticleRow = memo(ArticleRowImpl);

const makeStyles = (t: Theme) => ({
  standard: {
    paddingHorizontal: t.space.gutter,
    paddingTop: 16,
    paddingBottom: 18,
    backgroundColor: t.colors.bg,
  },
  standardTitle: { marginTop: 8 },
  standardBody: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 14, marginTop: 6 },
  excerpt: { flex: 1 },
  thumb: {
    width: 72,
    height: 72,
    borderRadius: t.radius.sm + 2,
    backgroundColor: t.colors.surfaceSunken,
    marginTop: 2,
  },
  compact: { paddingHorizontal: t.space.gutter, paddingVertical: 12, backgroundColor: t.colors.bg },
  compactTitle: { marginTop: 5 },
  cardOuter: { paddingHorizontal: t.space.gutter - 6, paddingVertical: 7, backgroundColor: t.colors.bg },
  card: {
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.lg,
    borderWidth: 1,
    borderColor: t.colors.hairline,
    overflow: 'hidden' as const,
  },
  cardImage: { width: '100%' as const, aspectRatio: 16 / 9, backgroundColor: t.colors.surfaceSunken },
  cardBody: { padding: 16 },
});
