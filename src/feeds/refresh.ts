import type { SQLiteDatabase } from 'expo-sqlite';

import { notifyChange } from '@/db/bus';
import { db, write, writeTransaction } from '@/db/client';
import { getFeed, listFeeds } from '@/db/feeds';
import type { ContentStatus, FeedRow } from '@/db/types';
import { extractArticle } from '@/extract/extractor';
import { whenIdle } from '@/lib/idle';
import { runPool } from '@/lib/pool';
import { useRefreshStore, type RefreshSummary } from '@/state/refreshStore';
import { settings } from '@/state/settings';

import { findSiteIcon } from './discover';
import { fetchText, HTML_ACCEPT } from './fetch';
import { downloadIcon, imageDownloadsAllowed, localizeImages, localizeThumb } from './images';
import { parseFeed, type NormalizedItem } from './parse';
import { applyRetention, retentionCutoff } from './retention';
import { fillImagePlaceholders, looksTruncated, sanitizeHtml, withVideoLead } from './sanitize';

type FeedResult = { newIds: number[]; failed: boolean };

/** A newly added feed contributes only its latest items; older ones are marked seen. */
const FIRST_FETCH_ITEMS = 25;
/** Per feed and refresh, how many truncated articles get full text in the background. */
const BACKGROUND_FULL_TEXT = 8;

/** Lets touches and renders run between chunks of synchronous parsing work, and waits out scrolling. */
const yieldToUi = whenIdle;

let running = false;
/** Specific feeds requested while a refresh was running; fetched right after it. */
const queued = new Set<number>();

/**
 * Refreshes all feeds (or `feedIds`) and returns once new articles are listed.
 * Full text and images continue in the background. A second full refresh while
 * one runs is ignored; specific feeds are queued.
 */
export async function refreshFeeds(feedIds?: number[]): Promise<RefreshSummary | null> {
  if (running) {
    feedIds?.forEach((id) => queued.add(id));
    return null;
  }
  running = true;
  const store = useRefreshStore;
  let summary: RefreshSummary | null = null;
  try {
    const all = await listFeeds();
    const feeds = feedIds ? all.filter((f) => feedIds.includes(f.id)) : all;
    store.setState({ running: true, done: 0, total: feeds.length });

    const newIds: number[] = [];
    let failed = 0;
    await runPool(feeds, 4, async (feed) => {
      const result = await refreshFeed(feed);
      newIds.push(...result.newIds);
      if (result.failed) failed++;
      store.setState((s) => ({ done: s.done + 1 }));
    });

    // An import refreshes only the new feeds, but still counts as the first update.
    if (!feedIds || feeds.length === all.length || !settings.get().lastRefreshAt) settings.set({ lastRefreshAt: Date.now() });
    summary = { newArticles: newIds.length, failedFeeds: failed, finishedAt: Date.now() };
    store.setState({ running: false, lastSummary: summary });
  } finally {
    running = false;
    store.setState({ running: false });
  }
  if (queued.size) {
    const next = [...queued];
    queued.clear();
    await refreshFeeds(next);
  }
  await applyRetention();
  // Offline downloads run outside the guard and are not awaited, so the caller
  // can report the result and the user can refresh again meanwhile.
  processPendingArticles().catch(() => {});
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
};

async function refreshFeed(feed: FeedRow): Promise<FeedResult> {
  const now = Date.now();
  try {
    const res = await fetchText(feed.url, { etag: feed.etag, lastModified: feed.last_modified });
    if (res.status === 'not-modified') {
      // Unchanged means every item is still listed, so its seen keys stay fresh too;
      // otherwise retention would forget them and undated items would return as new.
      await writeTransaction(async (conn) => {
        await conn.runAsync('UPDATE feeds SET last_fetched_at = ?, last_success_at = ?, last_error = NULL WHERE id = ?', [now, now, feed.id]);
        await conn.runAsync('UPDATE seen_items SET last_seen_at = ? WHERE feed_id = ?', [now, feed.id]);
      });
      notifyChange('feeds');
      return { newIds: [], failed: false };
    }

    const parsed = parseFeed(res.body, res.url);
    await yieldToUi();
    const cutoff = retentionCutoff(now);
    const items = parsed.items.slice().sort((a, b) => (b.publishedAt ?? now) - (a.publishedAt ?? now));

    // Which items are new is decided before any sanitizing, so known items cost nothing.
    const seenRows = await db().getAllAsync<{ key_hash: string }>('SELECT key_hash FROM seen_items WHERE feed_id = ?', [feed.id]);
    const seen = new Set(seenRows.map((r) => r.key_hash));
    const firstFetch = feed.last_success_at == null;
    const fresh = items.filter((item, i) => {
      if (seen.has(item.keyHash)) return false;
      if (firstFetch && i >= FIRST_FETCH_ITEMS) return false;
      const published = item.publishedAt ?? now;
      return !(cutoff && published < cutoff);
    });

    // Sanitizing is synchronous parser work; it runs outside the write lock and
    // yields between items so the UI stays responsive during big refreshes.
    const fullTextMode = feed.full_text_mode === 'auto' ? settings.get().fullTextDefault : feed.full_text_mode;
    const siteBase = parsed.siteUrl ?? feed.url;
    const prepared: PreparedItem[] = [];
    let backgroundBudget = BACKGROUND_FULL_TEXT;
    for (const item of fresh) {
      const clean = sanitizeHtml(withVideoLead(item.html, item.url), item.url ?? siteBase);
      let status: ContentStatus = 'feed';
      if (item.url && fullTextMode !== 'never' && (fullTextMode === 'always' || looksTruncated(clean.text))) {
        status = backgroundBudget-- > 0 ? 'pending' : 'lazy';
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
      });
      await yieldToUi();
    }

    const newIds: number[] = [];
    await writeTransaction(async (conn) => {
      for (const p of prepared) {
        const id = await insertArticle(conn, feed.id, p, now);
        if (id) newIds.push(id);
      }
      // Every key the feed serves is remembered, including items skipped above,
      // so retention and the first-fetch cap never let them reappear.
      for (const item of items) {
        await conn.runAsync(
          `INSERT INTO seen_items (feed_id, key_hash, last_seen_at) VALUES (?, ?, ?)
           ON CONFLICT(feed_id, key_hash) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
          [feed.id, item.keyHash, now],
        );
      }
      await conn.runAsync(
        `UPDATE feeds SET title = ?, site_url = COALESCE(?, site_url), description = COALESCE(?, description),
           icon_remote = COALESCE(?, icon_remote), etag = ?, last_modified = ?,
           last_fetched_at = ?, last_success_at = ?, last_error = NULL
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

    if (!feed.icon_path) await resolveIcon(feed.id, parsed.iconUrl, parsed.siteUrl ?? feed.site_url);
    return { newIds, failed: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await write((conn) =>
      conn.runAsync('UPDATE feeds SET last_fetched_at = ?, last_error = ? WHERE id = ?', [now, message.slice(0, 300), feed.id]),
    );
    notifyChange('feeds');
    return { newIds: [], failed: true };
  }
}

async function insertArticle(conn: SQLiteDatabase, feedId: number, p: PreparedItem, now: number): Promise<number | null> {
  const r = await conn.runAsync(
    `INSERT INTO articles (feed_id, key_hash, url, title, author, excerpt, thumb_remote,
       published_at, fetched_at, content_status, images_status, reading_minutes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
     ON CONFLICT(feed_id, key_hash) DO NOTHING`,
    [feedId, p.item.keyHash, p.item.url, p.title, p.item.author, p.excerpt, p.thumb, p.published, now, p.status, p.readingMinutes],
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
  const imagesAllowed = await imageDownloadsAllowed();
  // Images held back for Wi-Fi are fetched on the first run that is allowed to.
  const imagesWaiting = imagesAllowed ? `images_status IN ('pending', 'deferred')` : `images_status = 'pending'`;
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
  images_status: string;
  thumb_remote: string | null;
  thumb_path: string | null;
};

/**
 * Fetches full text when queued (or `forceFullText`), then downloads images.
 * Safe to call repeatedly. `priority` jumps the extraction queue for an article
 * the user is looking at.
 */
export async function makeOffline(
  id: number,
  imagesAllowed: boolean,
  opts: { forceFullText?: boolean; priority?: boolean } = {},
): Promise<void> {
  const row = await db().getFirstAsync<OfflineRow>(
    `SELECT a.id, a.url, b.content_html, b.content_text, a.content_status, a.images_status, a.thumb_remote, a.thumb_path
     FROM articles a LEFT JOIN article_bodies b ON b.article_id = a.id WHERE a.id = ?`,
    [id],
  );
  if (!row) return;

  const wantsFullText = row.content_status === 'pending' || (opts.forceFullText && row.content_status !== 'full');
  if (wantsFullText && row.url) {
    const extracted = await fetchFullText(row.url, !!opts.priority);
    const current = row.content_text?.length ?? 0;
    const clearlyLonger = !!extracted && extracted.text.length > current * 1.3 && extracted.text.length - current > 400;
    if (extracted && clearlyLonger) {
      await writeTransaction(async (conn) => {
        await conn.runAsync(
          `UPDATE article_bodies SET content_html = ?, content_text = ? WHERE article_id = ?`,
          [extracted.html, extracted.text, id],
        );
        // The feed's own excerpt is usually the cleaner summary; keep it when there is one.
        await conn.runAsync(
          `UPDATE articles SET excerpt = CASE WHEN excerpt = '' THEN ? ELSE excerpt END, reading_minutes = ?,
             content_status = 'full', images_status = 'pending', thumb_remote = COALESCE(thumb_remote, ?)
           WHERE id = ?`,
          [extracted.excerpt, extracted.readingMinutes, extracted.firstImage, id],
        );
      });
      row.content_html = extracted.html;
      row.images_status = 'pending';
      row.thumb_remote ??= extracted.firstImage;
    } else {
      // A page that yields no more text means the feed already had the whole post.
      const status: ContentStatus = extracted ? 'feed' : 'failed';
      await write((conn) => conn.runAsync(`UPDATE articles SET content_status = ? WHERE id = ?`, [status, id]));
    }
    notifyChange('articles');
  }

  if (row.images_status !== 'pending' && !(imagesAllowed && row.images_status === 'deferred')) return;
  // The list thumbnail is one small image, so it is fetched whenever possible.
  let thumbPath = row.thumb_path;
  if (!thumbPath && row.thumb_remote) thumbPath = await localizeThumb(id, row.thumb_remote);
  if (!imagesAllowed) {
    const later = settings.get().imageMode === 'wifi' ? 'deferred' : 'skipped';
    await write((conn) =>
      conn.runAsync(`UPDATE articles SET images_status = ?, thumb_path = ? WHERE id = ?`, [later, thumbPath, id]),
    );
    if (thumbPath) notifyChange('articles');
    return;
  }
  const { html, status } = await localizeHtmlImages(id, row.content_html ?? '');
  await writeTransaction(async (conn) => {
    await conn.runAsync('UPDATE article_bodies SET content_html = ? WHERE article_id = ?', [html, id]);
    await conn.runAsync('UPDATE articles SET images_status = ?, thumb_path = ? WHERE id = ?', [status, thumbPath, id]);
  });
  if (thumbPath !== row.thumb_path) notifyChange('articles');
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

async function fetchFullText(url: string, priority: boolean) {
  try {
    const res = await fetchText(url, { accept: HTML_ACCEPT, timeoutMs: 15000 });
    if (res.status !== 'ok') return null;
    const article = await extractArticle(res.body, res.url, { priority });
    if (!article) return null;
    await yieldToUi();
    const clean = sanitizeHtml(article.content, res.url);
    if (clean.text.length < 200) return null;
    return {
      html: fillImagePlaceholders(clean.html, clean.images, []),
      text: clean.text,
      excerpt: clean.excerpt,
      readingMinutes: clean.readingMinutes,
      firstImage: clean.images[0] ?? null,
    };
  } catch {
    return null;
  }
}
