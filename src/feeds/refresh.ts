import type { SQLiteDatabase } from 'expo-sqlite';

import { notifyChange } from '@/db/bus';
import { db, write, writeTransaction } from '@/db/client';
import { getFeed, listFeeds } from '@/db/feeds';
import type { ContentStatus, FeedRow } from '@/db/types';
import { extractArticle, whenExtractorReady } from '@/extract/extractor';
import { whenIdle } from '@/lib/idle';
import { runPool } from '@/lib/pool';
import { useRefreshStore, type RefreshSummary } from '@/state/refreshStore';
import { settings } from '@/state/settings';

import { findSiteIcon } from './discover';
import { FetchError, fetchText, HTML_ACCEPT, isTransient } from './fetch';
import { downloadIcon, imageDownloadsAllowed, isOnline, localizeImages, localizeThumb } from './images';
import { parseFeed, type NormalizedFeed, type NormalizedItem } from './parse';
import { applyRetention, retentionCutoff } from './retention';
import { fillImagePlaceholders, looksTruncated, sanitizeHtml, withVideoLead } from './sanitize';

/** `transient`: failed on the connection (offline, DNS, timeout), not on the feed itself. */
type FeedResult = { newIds: number[]; failed: boolean; transient: boolean };

/**
 * A newly added feed contributes its latest items whatever their age (the
 * retention window applies to later refreshes); any beyond are marked seen.
 */
const FIRST_FETCH_ITEMS = 100;
/** Of those, how many get images and background full text; the rest are text-only until opened. */
const FULL_IMPORT_ITEMS = 25;
/** Per feed and refresh, how many truncated articles get full text in the background. */
const BACKGROUND_FULL_TEXT = 8;
/** Connection failures fetching an article page before it is marked failed. */
const MAX_CONTENT_ATTEMPTS = 5;
/** Image passes for an article whose images only partly downloaded. */
const MAX_IMAGE_ATTEMPTS = 3;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Failures in a row before a feed is checked less often. */
const BACKOFF_AFTER = 3;

/** Lets touches and renders run between chunks of synchronous parsing work, and waits out scrolling. */
const yieldToUi = whenIdle;

let running = false;
/** Specific feeds requested while a refresh was running; fetched right after it. */
const queued = new Set<number>();

/**
 * Refreshes all feeds (or `feedIds`) and returns once new articles are listed.
 * Full text and images continue in the background unless `offline` is false
 * (the background task: it has no extractor WebView). A second full refresh
 * while one runs is ignored; specific feeds are queued. Automatic refreshes
 * skip feeds in backoff (`retry_after`); `includeHeld` (the user tapping
 * Refresh) and `refreshOne` fetch them anyway.
 */
export async function refreshFeeds(
  feedIds?: number[],
  opts: { offline?: boolean; includeHeld?: boolean } = {},
): Promise<RefreshSummary | null> {
  if (running) {
    feedIds?.forEach((id) => queued.add(id));
    return null;
  }
  running = true;
  const store = useRefreshStore;
  let summary: RefreshSummary | null = null;
  try {
    const all = await listFeeds();
    const now = Date.now();
    const feeds = (feedIds ? all.filter((f) => feedIds.includes(f.id)) : all).filter(
      (f) => opts.includeHeld || !f.retry_after || f.retry_after <= now,
    );
    store.setState({ running: true, done: 0, total: feeds.length });

    const newIds: number[] = [];
    let failed = 0;
    let succeeded = 0;
    const unreachable: FeedRow[] = [];
    await runPool(feeds, 4, async (feed) => {
      const result = await refreshFeed(feed);
      newIds.push(...result.newIds);
      if (result.failed) failed++;
      else succeeded++;
      if (result.transient) unreachable.push(feed);
      store.setState((s) => ({ done: s.done + 1 }));
    });
    // A connection failure counts against a feed only when other feeds got
    // through, so it's that site (gone, DNS) and not the phone being offline.
    if (succeeded > 0) {
      for (const feed of unreachable) await recordFailure(feed, null);
    }

    // An import refreshes only the new feeds, but still counts as the first update.
    if (!feedIds || feeds.length === all.length || !settings.get().lastRefreshAt) settings.set({ lastRefreshAt: Date.now() });
    summary = { newArticles: newIds.length, feeds: feeds.length, failedFeeds: failed, finishedAt: Date.now() };
    store.setState({ running: false, lastSummary: summary });
  } finally {
    running = false;
    store.setState({ running: false });
  }
  if (queued.size) {
    const next = [...queued];
    queued.clear();
    // Queued feeds belong to other callers, so they get the default options.
    await refreshFeeds(next);
  }
  await applyRetention();
  // Offline downloads run outside the guard and are not awaited, so the caller
  // can report the result and the user can refresh again meanwhile.
  if (opts.offline !== false) processPendingArticles().catch(() => {});
  return summary;
}

/**
 * Refreshes one feed immediately (used right after subscribing), even while a
 * full refresh is running. Returns the number of new articles.
 */
export async function refreshOne(feedId: number): Promise<{ added: number; error: string | null }> {
  const feed = await getFeed(feedId);
  if (!feed) return { added: 0, error: 'Feed not found' };
  const result = await refreshFeed(feed);
  processPendingArticles().catch(() => {});
  const after = await getFeed(feedId);
  return { added: result.newIds.length, error: result.failed ? (after?.last_error ?? 'Refresh failed') : null };
}

/**
 * Adds the posts a feed lists that aren't in the app, even ones marked seen:
 * older versions skipped posts past the retention window when a feed was
 * added, and the user asks for them explicitly here. Returns how many arrived.
 */
export async function loadOlderPosts(feedId: number): Promise<{ added: number; error: string | null }> {
  const feed = await getFeed(feedId);
  if (!feed) return { added: 0, error: 'Feed not found' };
  const now = Date.now();
  const newIds: number[] = [];
  try {
    const res = await fetchText(feed.url);
    if (res.status === 'not-modified') return { added: 0, error: null };
    const parsed = parseFeed(res.body, res.url);
    await yieldToUi();
    const items = newestFirst(parsed.items, now).slice(0, FIRST_FETCH_ITEMS);
    const have = new Set(
      (await db().getAllAsync<{ key_hash: string }>('SELECT key_hash FROM articles WHERE feed_id = ?', [feed.id])).map((r) => r.key_hash),
    );
    const missing = items.filter((item) => !have.has(item.keyHash));
    const prepared = await prepareItems(feed, parsed, missing, now, FULL_IMPORT_ITEMS);
    const seenAt = await seenKeys(feed.id);
    await writeTransaction(async (conn) => {
      for (const p of prepared) {
        const id = await insertArticle(conn, feed.id, p, now);
        if (id) newIds.push(id);
      }
      await rememberSeen(conn, feed.id, items, seenAt, now);
    });
  } catch (error) {
    return { added: 0, error: error instanceof Error ? error.message : String(error) };
  }
  if (newIds.length) {
    notifyChange('articles', 'feeds');
    processPendingArticles().catch(() => {});
  }
  return { added: newIds.length, error: null };
}

type PreparedItem = {
  item: NormalizedItem;
  published: number;
  title: string;
  excerpt: string;
  html: string;
  text: string;
  thumb: string | null;
  readingMinutes: number;
  status: ContentStatus;
  imagesStatus: 'pending' | 'skipped';
};

/**
 * Sanitizes `items` for insertion. Items from index `fullUpTo` on are
 * text-only: no image downloads and no background full text (it still loads
 * when the article is opened). Sanitizing is synchronous parser work; it runs
 * outside the write lock and yields between items so the UI stays responsive.
 */
async function prepareItems(
  feed: FeedRow,
  parsed: NormalizedFeed,
  items: NormalizedItem[],
  now: number,
  fullUpTo = Infinity,
): Promise<PreparedItem[]> {
  const fullTextMode = feed.full_text_mode === 'auto' ? settings.get().fullTextDefault : feed.full_text_mode;
  const siteBase = parsed.siteUrl ?? feed.url;
  const prepared: PreparedItem[] = [];
  let backgroundBudget = BACKGROUND_FULL_TEXT;
  for (const [i, item] of items.entries()) {
    const full = i < fullUpTo;
    const clean = sanitizeHtml(withVideoLead(item.html, item.url), item.url ?? siteBase);
    let status: ContentStatus = 'feed';
    if (item.url && fullTextMode !== 'never' && (fullTextMode === 'always' || looksTruncated(clean.text))) {
      status = full && backgroundBudget-- > 0 ? 'pending' : 'lazy';
    }
    prepared.push({
      item,
      published: item.publishedAt ?? now,
      title: item.title || clean.excerpt.slice(0, 80) || 'Untitled',
      excerpt: clean.excerpt,
      html: fillImagePlaceholders(clean.html, clean.images, []),
      text: clean.text,
      thumb: item.thumbUrl ?? clean.images[0] ?? null,
      readingMinutes: clean.readingMinutes,
      status,
      imagesStatus: full ? 'pending' : 'skipped',
    });
    await yieldToUi();
  }
  return prepared;
}

/** Newest first; undated items count as published now. */
function newestFirst(items: NormalizedItem[], now: number): NormalizedItem[] {
  return items.slice().sort((a, b) => (b.publishedAt ?? now) - (a.publishedAt ?? now));
}

/** Remembers every key the feed serves, skipping keys refreshed within the last day. */
async function rememberSeen(conn: SQLiteDatabase, feedId: number, items: NormalizedItem[], seenAt: Map<string, number>, now: number) {
  for (const item of items) {
    const lastSeen = seenAt.get(item.keyHash);
    if (lastSeen !== undefined && lastSeen > now - DAY) continue;
    await conn.runAsync(
      `INSERT INTO seen_items (feed_id, key_hash, last_seen_at) VALUES (?, ?, ?)
       ON CONFLICT(feed_id, key_hash) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
      [feedId, item.keyHash, now],
    );
  }
}

async function seenKeys(feedId: number): Promise<Map<string, number>> {
  const rows = await db().getAllAsync<{ key_hash: string; last_seen_at: number }>(
    'SELECT key_hash, last_seen_at FROM seen_items WHERE feed_id = ?',
    [feedId],
  );
  return new Map(rows.map((r) => [r.key_hash, r.last_seen_at]));
}

async function refreshFeed(feed: FeedRow): Promise<FeedResult> {
  const now = Date.now();
  try {
    const res = await fetchText(feed.url, { etag: feed.etag, lastModified: feed.last_modified });
    if (res.status === 'not-modified') {
      // Unchanged means every item is still listed, so its seen keys stay fresh too;
      // otherwise retention would forget them and undated items would return as new.
      await writeTransaction(async (conn) => {
        await conn.runAsync(
          `UPDATE feeds SET last_fetched_at = ?, last_success_at = ?, last_error = NULL, fail_count = 0, retry_after = NULL
           WHERE id = ?`,
          [now, now, feed.id],
        );
        await conn.runAsync('UPDATE seen_items SET last_seen_at = ? WHERE feed_id = ? AND last_seen_at < ?', [now, feed.id, now - DAY]);
      });
      notifyChange('feeds');
      return { newIds: [], failed: false, transient: false };
    }

    const parsed = parseFeed(res.body, res.url);
    await yieldToUi();
    const items = newestFirst(parsed.items, now);

    // Which items are new is decided before any sanitizing, so known items cost nothing.
    const seenAt = await seenKeys(feed.id);
    // A new feed shows what it lists, however old (up to a cap). Afterwards an
    // unseen item older than the retention window is one it already removed.
    const firstFetch = feed.last_success_at == null;
    const cutoff = firstFetch ? null : retentionCutoff(now);
    const fresh = items.filter((item, i) => {
      if (seenAt.has(item.keyHash)) return false;
      if (firstFetch && i >= FIRST_FETCH_ITEMS) return false;
      const published = item.publishedAt ?? now;
      return !(cutoff && published < cutoff);
    });
    const prepared = await prepareItems(feed, parsed, fresh, now, firstFetch ? FULL_IMPORT_ITEMS : Infinity);

    const newIds: number[] = [];
    await writeTransaction(async (conn) => {
      for (const p of prepared) {
        const id = await insertArticle(conn, feed.id, p, now);
        if (id) newIds.push(id);
      }
      // Every key the feed serves is remembered, including items skipped above,
      // so retention and the first-fetch cap never let them reappear. A key seen
      // within the last day is fresh enough; retention forgets keys only after
      // twice its window (at least 14 days), so this skips most writes.
      await rememberSeen(conn, feed.id, items, seenAt, now);
      await conn.runAsync(
        `UPDATE feeds SET title = ?, site_url = COALESCE(?, site_url), description = COALESCE(?, description),
           icon_remote = COALESCE(?, icon_remote), etag = ?, last_modified = ?,
           last_fetched_at = ?, last_success_at = ?, last_error = NULL, fail_count = 0, retry_after = NULL
         WHERE id = ?`,
        [
          parsed.title || feed.title,
          parsed.siteUrl,
          parsed.description,
          parsed.iconUrl,
          res.etag,
          res.lastModified,
          now,
          now,
          feed.id,
        ],
      );
    });
    notifyChange(newIds.length ? 'articles' : 'feeds', 'feeds');

    // A site without a usable icon is asked again weekly, not on every refresh.
    if (!feed.icon_path && (!feed.icon_tried_at || feed.icon_tried_at < now - 7 * DAY)) {
      await resolveIcon(feed.id, parsed.iconUrl, parsed.siteUrl ?? feed.site_url);
    }
    return { newIds, failed: false, transient: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await write((conn) =>
      conn.runAsync('UPDATE feeds SET last_fetched_at = ?, last_error = ? WHERE id = ?', [now, message.slice(0, 300), feed.id]),
    );
    const transient = isTransient(error);
    // Connection failures are judged by the caller, which knows if anything else got through.
    if (!transient) await recordFailure(feed, error);
    notifyChange('feeds');
    return { newIds: [], failed: true, transient };
  }
}

/**
 * Counts a failure and, after a few in a row, holds the feed back: 6 hours,
 * doubling up to 3 days. A server's own Retry-After (429/503) wins. Success
 * resets both.
 */
async function recordFailure(feed: FeedRow, error: unknown) {
  const now = Date.now();
  const failures = (feed.fail_count ?? 0) + 1;
  let retryAfter: number | null = null;
  if (error instanceof FetchError && (error.status === 429 || (error.status === 503 && error.retryAfter !== undefined))) {
    const seconds = error.retryAfter ?? 3600;
    retryAfter = now + Math.min(Math.max(seconds * 1000, MINUTE), DAY);
  } else if (failures >= BACKOFF_AFTER) {
    retryAfter = now + Math.min(6 * HOUR * 2 ** (failures - BACKOFF_AFTER), 3 * DAY);
  }
  await write((conn) =>
    conn.runAsync('UPDATE feeds SET fail_count = ?, retry_after = ? WHERE id = ?', [failures, retryAfter, feed.id]),
  );
}

async function insertArticle(conn: SQLiteDatabase, feedId: number, p: PreparedItem, now: number): Promise<number | null> {
  const r = await conn.runAsync(
    `INSERT INTO articles (feed_id, key_hash, url, title, author, excerpt, thumb_remote,
       published_at, fetched_at, content_status, images_status, reading_minutes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(feed_id, key_hash) DO NOTHING`,
    [
      feedId,
      p.item.keyHash,
      p.item.url,
      p.title,
      p.item.author,
      p.excerpt,
      p.thumb,
      p.published,
      now,
      p.status,
      p.imagesStatus,
      p.readingMinutes,
    ],
  );
  if (!r.changes) return null;
  await conn.runAsync('INSERT INTO article_bodies (article_id, content_html, content_text) VALUES (?, ?, ?)', [
    r.lastInsertRowId,
    p.html,
    p.text,
  ]);
  return r.lastInsertRowId;
}

async function resolveIcon(feedId: number, iconUrl: string | null, siteUrl: string | null) {
  const candidates = [iconUrl, siteUrl ? await findSiteIcon(siteUrl) : null].filter((u): u is string => !!u);
  for (const url of candidates) {
    const local = await downloadIcon(feedId, url);
    if (local) {
      await write((conn) => conn.runAsync('UPDATE feeds SET icon_path = ? WHERE id = ?', [local, feedId]));
      notifyChange('feeds', 'articles');
      return;
    }
  }
  await write((conn) => conn.runAsync('UPDATE feeds SET icon_tried_at = ? WHERE id = ?', [Date.now(), feedId]));
}

let processing: Promise<void> | null = null;
let rerun = false;

/**
 * Finishes every article still waiting for full text or images, newest first.
 * A call while a run is in progress makes that run go round once more.
 */
export function processPendingArticles(): Promise<void> {
  if (processing) {
    rerun = true;
    return processing;
  }
  processing = (async () => {
    try {
      do {
        rerun = false;
        await processAll();
      } while (rerun);
    } finally {
      processing = null;
      useRefreshStore.setState({ pendingOffline: 0 });
    }
  })();
  return processing;
}

const BATCH = 40;

async function processAll(): Promise<void> {
  // Offline, every download would fail; the next refresh or launch tries again.
  if (!(await isOnline())) return;
  const imagesAllowed = await imageDownloadsAllowed();
  // Images held back for Wi-Fi are fetched on the first run that is allowed to,
  // and articles whose images only partly arrived get a few more tries.
  const imagesWaiting = imagesAllowed
    ? `(images_status IN ('pending', 'deferred') OR (images_status = 'partial' AND image_attempts < ${MAX_IMAGE_ATTEMPTS}))`
    : `images_status = 'pending'`;
  const done = new Set<number>();
  for (;;) {
    // Each batch re-reads the queue, so articles added meanwhile are picked up in order.
    const rows = await db().getAllAsync<{ id: number }>(
      `SELECT id FROM articles WHERE content_status = 'pending'
       UNION SELECT id FROM articles WHERE ${imagesWaiting}
       ORDER BY id DESC LIMIT ?`,
      [BATCH + done.size],
    );
    const batch = rows.filter((r) => !done.has(r.id)).slice(0, BATCH);
    if (!batch.length) return;
    const remaining = await db().getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM articles WHERE content_status = 'pending' OR ${imagesWaiting}`,
    );
    useRefreshStore.setState({ pendingOffline: remaining?.n ?? batch.length });
    await runPool(batch, 3, async ({ id }) => {
      done.add(id);
      await whenIdle();
      await makeOffline(id, imagesAllowed);
    });
  }
}

type OfflineRow = {
  id: number;
  url: string | null;
  content_html: string | null;
  content_text: string | null;
  content_status: ContentStatus;
  content_attempts: number;
  images_status: string;
  image_attempts: number;
  thumb_remote: string | null;
  thumb_path: string | null;
};

/** What `makeOffline` did about full text, for the reader's messages. */
export type FullTextOutcome = 'full' | 'feed' | 'failed' | 'unreachable' | 'skipped';

/**
 * Fetches full text when queued (or `forceFullText`), then downloads images.
 * Safe to call repeatedly. `priority` jumps the extraction queue for an article
 * the user is looking at.
 */
export async function makeOffline(
  id: number,
  imagesAllowed: boolean,
  opts: { forceFullText?: boolean; priority?: boolean } = {},
): Promise<FullTextOutcome> {
  const row = await db().getFirstAsync<OfflineRow>(
    `SELECT a.id, a.url, b.content_html, b.content_text, a.content_status, a.content_attempts, a.images_status,
       a.image_attempts, a.thumb_remote, a.thumb_path
     FROM articles a LEFT JOIN article_bodies b ON b.article_id = a.id WHERE a.id = ?`,
    [id],
  );
  if (!row) return 'skipped';
  // With no connection every download fails, and a failed pass would use up
  // the article's retries for nothing. The next pass online does the work.
  if (!(await isOnline())) return row.content_status === 'pending' || opts.forceFullText ? 'unreachable' : 'skipped';

  let outcome: FullTextOutcome = 'skipped';
  const wantsFullText = row.content_status === 'pending' || (opts.forceFullText && row.content_status !== 'full');
  if (wantsFullText && row.url) {
    const result = await fetchFullText(row.url, !!opts.priority);
    const extracted = result.kind === 'ok' ? result : null;
    const current = row.content_text?.length ?? 0;
    const clearlyLonger = !!extracted && extracted.text.length > current * 1.3 && extracted.text.length - current > 400;
    if (result.kind === 'retry') {
      // Offline or the site didn't answer: try again on a later pass, a few times.
      const attempts = row.content_attempts + 1;
      const giveUp = attempts >= MAX_CONTENT_ATTEMPTS;
      await write((conn) =>
        conn.runAsync(
          `UPDATE articles SET content_attempts = ?, content_status = CASE WHEN ? THEN 'failed' ELSE content_status END WHERE id = ?`,
          [attempts, giveUp ? 1 : 0, id],
        ),
      );
      outcome = 'unreachable';
      if (giveUp) notifyChange('articles');
    } else if (extracted && clearlyLonger) {
      await writeTransaction(async (conn) => {
        await conn.runAsync(
          `UPDATE article_bodies SET content_html = ?, content_text = ? WHERE article_id = ?`,
          [extracted.html, extracted.text, id],
        );
        // The feed's own excerpt is usually the cleaner summary; keep it when there is one.
        await conn.runAsync(
          `UPDATE articles SET excerpt = CASE WHEN excerpt = '' THEN ? ELSE excerpt END, reading_minutes = ?,
             content_status = 'full', images_status = 'pending', image_attempts = 0, thumb_remote = COALESCE(thumb_remote, ?)
           WHERE id = ?`,
          [extracted.excerpt, extracted.readingMinutes, extracted.firstImage, id],
        );
      });
      row.content_html = extracted.html;
      row.images_status = 'pending';
      row.image_attempts = 0;
      row.thumb_remote ??= extracted.firstImage;
      outcome = 'full';
    } else {
      // A page that yields no more text means the feed already had the whole post.
      const status: ContentStatus = extracted ? 'feed' : 'failed';
      await write((conn) => conn.runAsync(`UPDATE articles SET content_status = ? WHERE id = ?`, [status, id]));
      outcome = status;
    }
    notifyChange('articles');
  }

  const imagesDue =
    row.images_status === 'pending' ||
    (imagesAllowed && row.images_status === 'deferred') ||
    (imagesAllowed && row.images_status === 'partial' && row.image_attempts < MAX_IMAGE_ATTEMPTS);
  if (!imagesDue) return outcome;
  if (!imagesAllowed) {
    // "Wi-Fi only" waits for Wi-Fi, thumbnail included; "Never" downloads nothing.
    const later = settings.get().imageMode === 'wifi' ? 'deferred' : 'skipped';
    await write((conn) => conn.runAsync(`UPDATE articles SET images_status = ? WHERE id = ?`, [later, id]));
    return outcome;
  }
  let thumbPath = row.thumb_path;
  if (!thumbPath && row.thumb_remote) thumbPath = await localizeThumb(id, row.thumb_remote);
  const { html, status } = await localizeHtmlImages(id, row.content_html ?? '');
  await writeTransaction(async (conn) => {
    // Only if the body is still the one these images came from: full text may
    // have replaced it meanwhile (and reset images_status for its own pass).
    const r = await conn.runAsync('UPDATE article_bodies SET content_html = ? WHERE article_id = ? AND content_html IS ?', [
      html,
      id,
      row.content_html,
    ]);
    if (r.changes) {
      await conn.runAsync('UPDATE articles SET images_status = ?, image_attempts = image_attempts + 1, thumb_path = ? WHERE id = ?', [
        status,
        thumbPath,
        id,
      ]);
    } else {
      await conn.runAsync('UPDATE articles SET thumb_path = COALESCE(thumb_path, ?) WHERE id = ?', [thumbPath, id]);
    }
  });
  if (thumbPath !== row.thumb_path) notifyChange('articles');
  return outcome;
}

const IMG_SRC = /src="([^"]*)" data-remote="([^"]*)"/g;

function unescapeAttr(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
}

async function localizeHtmlImages(articleId: number, html: string): Promise<{ html: string; status: 'done' | 'partial' }> {
  const remotes: string[] = [];
  for (const m of html.matchAll(IMG_SRC)) {
    const remote = unescapeAttr(m[2]!);
    if (/^https?:/.test(m[1]!) && remote && !remotes.includes(remote)) remotes.push(remote);
  }
  const local = await localizeImages(articleId, remotes);
  const map = new Map(remotes.map((r, i) => [r, local[i]]));
  const out = html.replace(IMG_SRC, (whole, _src: string, remoteAttr: string) => {
    const path = map.get(unescapeAttr(remoteAttr));
    return path ? `src="${path}" data-remote="${remoteAttr}"` : whole;
  });
  return { html: out, status: local.every(Boolean) ? 'done' : 'partial' };
}

type FullTextResult =
  | { kind: 'ok'; html: string; text: string; excerpt: string; readingMinutes: number; firstImage: string | null }
  /** The page was read but gave no usable article, or the site refused it. */
  | { kind: 'none' }
  /** No connection, a timeout, or the extractor isn't running yet: worth another try. */
  | { kind: 'retry' };

async function fetchFullText(url: string, priority: boolean): Promise<FullTextResult> {
  // Without the extractor WebView (a cold start before it loads, or a headless
  // run) the page download would be wasted.
  if (!(await whenExtractorReady(15000))) return { kind: 'retry' };
  try {
    const res = await fetchText(url, { accept: HTML_ACCEPT, timeoutMs: 15000 });
    if (res.status !== 'ok') return { kind: 'none' };
    const article = await extractArticle(res.body, res.url, { priority });
    if (!article) return { kind: 'none' };
    await yieldToUi();
    const clean = sanitizeHtml(article.content, res.url);
    if (clean.text.length < 200) return { kind: 'none' };
    return {
      kind: 'ok',
      html: fillImagePlaceholders(clean.html, clean.images, []),
      text: clean.text,
      excerpt: clean.excerpt,
      readingMinutes: clean.readingMinutes,
      firstImage: clean.images[0] ?? null,
    };
  } catch (error) {
    return isTransient(error) ? { kind: 'retry' } : { kind: 'none' };
  }
}
