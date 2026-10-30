export type FullTextMode = 'auto' | 'always' | 'never';
/**
 * pending: full text queued for the background pass. lazy: the feed's text looks
 * truncated, but full text is fetched only when the article is opened.
 */
export type ContentStatus = 'pending' | 'lazy' | 'feed' | 'full' | 'failed';
// 'deferred': waiting for Wi-Fi; 'skipped': images are off or the cache was cleared.
export type ImagesStatus = 'pending' | 'done' | 'partial' | 'skipped' | 'deferred';

export type FeedRow = {
  id: number;
  url: string;
  site_url: string | null;
  title: string;
  custom_title: string | null;
  description: string | null;
  icon_path: string | null;
  icon_remote: string | null;
  etag: string | null;
  last_modified: string | null;
  last_fetched_at: number | null;
  last_success_at: number | null;
  last_error: string | null;
  full_text_mode: FullTextMode;
  created_at: number;
};

/** A feed as shown in lists: display title resolved, with unread count. */
export type FeedSummary = {
  id: number;
  url: string;
  site_url: string | null;
  name: string;
  icon_path: string | null;
  unread: number;
  total: number;
  last_success_at: number | null;
  last_error: string | null;
};

/** Lightweight row for the timeline. Excludes content columns. */
export type ArticleListItem = {
  id: number;
  feed_id: number;
  feed_name: string;
  feed_icon: string | null;
  url: string | null;
  title: string;
  excerpt: string;
  thumb_path: string | null;
  published_at: number;
  reading_minutes: number;
  is_read: number;
  is_saved: number;
  images_status: ImagesStatus;
};

export type ArticleFull = ArticleListItem & {
  author: string | null;
  content_html: string | null;
  content_status: ContentStatus;
  feed_site_url: string | null;
  full_text_mode: FullTextMode;
};

export type ArticleFilter = (
  | { kind: 'all'; hideRead: boolean }
  | { kind: 'saved'; hideRead: boolean }
  | { kind: 'feed'; feedId: number; hideRead: boolean }
) & {
  /** With hideRead, articles read at or after this time stay listed. */
  keepReadSince?: number;
};
