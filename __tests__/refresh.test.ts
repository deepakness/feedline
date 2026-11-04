/* eslint-disable import/first, @typescript-eslint/no-require-imports -- jest.mock factories must be hoisted and lazy */
/**
 * Integration test for the refresh pipeline against a real SQLite engine.
 * expo-sqlite is replaced by a thin adapter over Node's built-in `node:sqlite`,
 * so the production migrations, queries and triggers all run unmodified.
 */
jest.mock('expo-sqlite', () => {
  const toArgs = (params: unknown) => (params === undefined ? [] : Array.isArray(params) ? params : [params]);
  return {
    openDatabaseAsync: async () => {
      const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
      const raw = new DatabaseSync(':memory:');
      const db = {
        execAsync: async (sql: string) => raw.exec(sql),
        runAsync: async (sql: string, params?: unknown) => {
          const r = raw.prepare(sql).run(...(toArgs(params) as never[]));
          return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
        },
        getFirstAsync: async (sql: string, params?: unknown) => raw.prepare(sql).get(...(toArgs(params) as never[])) ?? null,
        getAllAsync: async (sql: string, params?: unknown) => raw.prepare(sql).all(...(toArgs(params) as never[])),
        withTransactionAsync: async (task: () => Promise<void>) => {
          raw.exec('BEGIN');
          try {
            await task();
            raw.exec('COMMIT');
          } catch (e) {
            raw.exec('ROLLBACK');
            throw e;
          }
        },
      };
      return db;
    },
  };
});
jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: { getItemSync: () => null, setItem: async () => {} },
}));
jest.mock('expo-file-system', () => ({ Directory: class {}, File: class {}, Paths: {} }));
jest.mock('expo-network', () => ({ getNetworkStateAsync: async () => ({}), NetworkStateType: {} }));
jest.mock('@/extract/extractor', () => ({
  extractArticle: async () => mockExtracted,
  whenExtractorReady: async () => true,
}));
jest.mock('@/feeds/images', () => ({
  imageDownloadsAllowed: async () => false,
  isOnline: async () => mockOnline,
  localizeImages: jest.fn(async (_id: number, urls: string[]) => urls.map(() => null)),
  localizeThumb: async () => null,
  downloadIcon: async () => null,
  deleteArticleImages: jest.fn(),
}));
jest.mock('@/feeds/discover', () => ({ findSiteIcon: async () => null }));

const mockNotModified = '\u0000304';
/** A body, or an HTTP status to fail with (e.g. 404, 429). Missing means "Network unavailable". */
const mockFeedBodies: Record<string, string | number> = {};
let mockOnline = true;
let mockExtracted: { title: null; byline: null; content: string; length: number } | null = null;
jest.mock('@/feeds/fetch', () => {
  const actual = jest.requireActual('@/feeds/errors') as typeof import('@/feeds/errors');
  return {
    HTML_ACCEPT: '',
    FetchError: actual.FetchError,
    isTransient: actual.isTransient,
    fetchText: async (url: string) => {
      const body = mockFeedBodies[url];
      if (body === undefined) throw new actual.FetchError('Network unavailable', { kind: 'network' });
      if (typeof body === 'number') {
        throw new actual.FetchError(`HTTP ${body}`, { kind: 'http', status: body, retryAfter: body === 429 ? 120 : undefined });
      }
      if (body === mockNotModified) return { status: 'not-modified' };
      return { status: 'ok', url, body, contentType: 'application/rss+xml', etag: null, lastModified: null };
    },
  };
});

import { listArticles, markAllRead, searchArticles, setRead, setSaved } from '@/db/articles';
import { db, getDb } from '@/db/client';
import { getFeed, insertFeed, setFullTextMode, sortFeeds } from '@/db/feeds';
import type { FeedSummary } from '@/db/types';
import { localizeImages } from '@/feeds/images';
import { loadOlderPosts, makeOffline, refreshFeeds, refreshOne } from '@/feeds/refresh';
import { applyRetention, countExpired } from '@/feeds/retention';
import { settings } from '@/state/settings';

const DAY = 864e5;

function rss(items: { guid: string; title: string; ageDays: number; body?: string }[]) {
  const entries = items
    .map(
      (i) => `<item><guid>${i.guid}</guid><title>${i.title}</title><link>https://site.test/${i.guid}</link>
      <pubDate>${new Date(Date.now() - i.ageDays * DAY).toUTCString()}</pubDate>
      <description><![CDATA[<p>${i.body ?? 'word '.repeat(200)}</p>]]></description></item>`,
    )
    .join('');
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Test Feed</title><link>https://site.test/</link>${entries}</channel></rss>`;
}

const all = () => listArticles({ kind: 'all', hideRead: false }, 1000);

beforeAll(async () => {
  await getDb();
  settings.set({ retentionDays: 30, fullTextDefault: 'never', imageMode: 'off' });
});

it('imports a new feed whatever the age of its posts, dedupes, and skips old unseen posts later', async () => {
  const url = 'https://site.test/feed';
  const id = await insertFeed({ url });
  mockFeedBodies[url] = rss([
    { guid: 'a', title: 'Fresh one', ageDays: 1, body: 'The quick zebra jumps' },
    { guid: 'b', title: 'Fresh two', ageDays: 8 },
    { guid: 'old', title: 'Older than the window', ageDays: 45 },
  ]);

  // A newly added feed shows what it lists, even past the 30-day window.
  const first = await refreshFeeds();
  expect(first).toEqual(expect.objectContaining({ newArticles: 3, failedFeeds: 0 }));
  expect((await all()).map((a) => a.title)).toEqual(['Fresh one', 'Fresh two', 'Older than the window']);
  expect((await getFeed(id))!.title).toBe('Test Feed');
  // Retention counts from arrival, so the old post stays.
  expect(await applyRetention()).toBe(0);

  // Same items again: nothing new.
  expect((await refreshFeeds())!.newArticles).toBe(0);
  expect(await all()).toHaveLength(3);

  // Search finds content via the FTS triggers.
  expect((await searchArticles('zebr')).map((h) => h.title)).toEqual(['Fresh one']);

  // After the first fetch, an unseen post older than the window isn't added.
  mockFeedBodies[url] = rss([
    { guid: 'a', title: 'Fresh one', ageDays: 1 },
    { guid: 'late', title: 'Late old post', ageDays: 40 },
    { guid: 'c', title: 'Brand new', ageDays: 0 },
  ]);
  expect((await refreshFeeds())!.newArticles).toBe(1);
  expect((await all()).map((a) => a.title)).toEqual(['Brand new', 'Fresh one', 'Fresh two', 'Older than the window']);
});

it('records failures per feed without affecting others', async () => {
  const id = await insertFeed({ url: 'https://down.test/feed' });
  const summary = await refreshFeeds();
  expect(summary!.failedFeeds).toBe(1);
  expect((await getFeed(id))!.last_error).toBe('Network unavailable');
});

it('imports up to 100 posts from a new feed, text-only past the newest 25, and never adds the rest later', async () => {
  const url = 'https://big.test/feed';
  const id = await insertFeed({ url });
  await setFullTextMode(id, 'always');
  // 120 posts, the oldest four months old: well past the 30-day window.
  const items = Array.from({ length: 120 }, (_, i) => ({ guid: `big${i}`, title: `Big ${i}`, ageDays: i }));
  mockFeedBodies[url] = rss(items);
  await refreshFeeds([id], { offline: false });
  const mine = () => listArticles({ kind: 'feed', feedId: id, hideRead: false }, 1000);
  const first = await mine();
  expect(first).toHaveLength(100);
  expect(first[0]!.title).toBe('Big 0');
  expect(first[99]!.title).toBe('Big 99');

  const rows = await db().getAllAsync<{ title: string; content_status: string; images_status: string }>(
    'SELECT title, content_status, images_status FROM articles WHERE feed_id = ? ORDER BY published_at DESC',
    [id],
  );
  // The newest 25 download images; background full text stays within its per-feed budget.
  expect(rows.slice(0, 25).every((r) => r.images_status === 'pending')).toBe(true);
  expect(rows.filter((r) => r.content_status === 'pending').map((r) => r.title)).toEqual(
    Array.from({ length: 8 }, (_, i) => `Big ${i}`),
  );
  // The rest are text-only: no images, full text only when opened.
  expect(rows.slice(25).every((r) => r.images_status === 'skipped' && r.content_status === 'lazy')).toBe(true);

  await refreshFeeds([id], { offline: false });
  expect(await mine()).toHaveLength(100);
});

it('loads older posts that an earlier version skipped', async () => {
  const url = 'https://skipped.test/feed';
  const id = await insertFeed({ url });
  mockFeedBodies[url] = rss([{ guid: 's0', title: 'Recent', ageDays: 1 }]);
  await refreshFeeds([id]);
  // Older posts appear that the window rules out: marked seen, not added.
  mockFeedBodies[url] = rss([
    { guid: 's0', title: 'Recent', ageDays: 1 },
    { guid: 's1', title: 'Older', ageDays: 40 },
    { guid: 's2', title: 'Oldest', ageDays: 90 },
  ]);
  expect((await refreshFeeds([id]))!.newArticles).toBe(0);
  const mine = async () => (await listArticles({ kind: 'feed', feedId: id, hideRead: false }, 100)).map((a) => a.title);
  expect(await mine()).toEqual(['Recent']);

  expect(await loadOlderPosts(id)).toEqual({ added: 2, error: null });
  expect(await mine()).toEqual(['Recent', 'Older', 'Oldest']);
  expect(await loadOlderPosts(id)).toEqual({ added: 0, error: null });

  delete mockFeedBodies[url];
  expect(await loadOlderPosts(id)).toEqual({ added: 0, error: 'Network unavailable' });
});

it('keeps seen keys fresh while a feed answers "not modified"', async () => {
  const url = 'https://quiet.test/feed';
  const id = await insertFeed({ url });
  mockFeedBodies[url] = rss([{ guid: 'q1', title: 'Quiet one', ageDays: 0 }]);
  await refreshFeeds([id]);
  await db().runAsync('UPDATE seen_items SET last_seen_at = 0 WHERE feed_id = ?', [id]);
  mockFeedBodies[url] = mockNotModified;
  await refreshFeeds([id]);
  const row = await db().getFirstAsync<{ oldest: number }>('SELECT MIN(last_seen_at) AS oldest FROM seen_items WHERE feed_id = ?', [id]);
  expect(row!.oldest).toBeGreaterThan(Date.now() - 60_000);
});

it('keeps recently read articles listed under "Hide read" until the cutoff moves', async () => {
  const url = 'https://keep.test/feed';
  const feedId = await insertFeed({ url });
  mockFeedBodies[url] = rss([
    { guid: 'k1', title: 'Keep one', ageDays: 0 },
    { guid: 'k2', title: 'Keep two', ageDays: 0.1 },
    { guid: 'k3', title: 'Keep three', ageDays: 0.2 },
  ]);
  await refreshFeeds([feedId]);
  const [one, two] = await listArticles({ kind: 'feed', feedId, hideRead: false }, 10);
  // Read long ago, and just now.
  await setRead([one!.id], true);
  await db().runAsync('UPDATE articles SET read_at = 1000 WHERE id = ?', [one!.id]);
  await setRead([two!.id], true);

  const since = Date.now() - 60_000;
  const titles = async (keepReadSince?: number) =>
    (await listArticles({ kind: 'feed', feedId, hideRead: true, keepReadSince }, 10)).map((a) => a.title);
  expect(await titles()).toEqual(['Keep three']);
  expect(await titles(since)).toEqual(['Keep two', 'Keep three']);
  expect(await titles(Date.now() + 1)).toEqual(['Keep three']);

  // Marking all read ignores the kept window: only unread articles change.
  const marked = await markAllRead({ kind: 'feed', feedId, hideRead: true, keepReadSince: since });
  expect(marked).toHaveLength(1);
});

it('narrows search to one feed or to Saved', async () => {
  const a = await insertFeed({ url: 'https://scope-a.test/feed' });
  const b = await insertFeed({ url: 'https://scope-b.test/feed' });
  mockFeedBodies['https://scope-a.test/feed'] = rss([{ guid: 'sa', title: 'Walrus from A', ageDays: 0, body: 'walrus tusks' }]);
  mockFeedBodies['https://scope-b.test/feed'] = rss([{ guid: 'sb', title: 'Walrus from B', ageDays: 0, body: 'walrus again' }]);
  await refreshFeeds([a, b]);
  const titles = async (...args: Parameters<typeof searchArticles>) => (await searchArticles(...args)).map((h) => h.title).sort();
  expect(await titles('walrus')).toEqual(['Walrus from A', 'Walrus from B']);
  expect(await titles('walrus', { kind: 'feed', feedId: b, hideRead: false })).toEqual(['Walrus from B']);
  expect(await titles('walrus', { kind: 'saved', hideRead: false })).toEqual([]);
  const [hit] = await searchArticles('walrus', { kind: 'feed', feedId: a, hideRead: false });
  await setSaved(hit!.id, true);
  expect(await titles('walrus', { kind: 'saved', hideRead: false })).toEqual(['Walrus from A']);
});

it('sorts feeds by unread, keeping name order for ties', () => {
  const feed = (name: string, unread: number) => ({ name, unread }) as FeedSummary;
  const byName = [feed('Alpha', 1), feed('Beta', 5), feed('Gamma', 1)];
  expect(sortFeeds(byName, 'unread').map((f) => f.name)).toEqual(['Beta', 'Alpha', 'Gamma']);
  expect(sortFeeds(byName, 'name')).toBe(byName);
});

type FeedState = { fail_count: number; retry_after: number | null };
const feedState = (id: number) => db().getFirstAsync<FeedState>('SELECT fail_count, retry_after FROM feeds WHERE id = ?', [id]);

it('backs off a feed after repeated HTTP failures, and resets on success', async () => {
  const url = 'https://dead.test/feed';
  const id = await insertFeed({ url });
  mockFeedBodies[url] = 404;
  for (let i = 0; i < 2; i++) await refreshFeeds([id]);
  expect(await feedState(id)).toEqual({ fail_count: 2, retry_after: null });

  await refreshFeeds([id]);
  const held = (await feedState(id))!;
  expect(held.fail_count).toBe(3);
  expect(held.retry_after).toBeGreaterThan(Date.now() + 5 * 3600e3);

  // Held back: an automatic refresh skips it entirely.
  expect(await refreshFeeds([id])).toEqual(expect.objectContaining({ feeds: 0, failedFeeds: 0 }));
  expect((await feedState(id))!.fail_count).toBe(3);
  // The user tapping Refresh tries it anyway.
  expect(await refreshFeeds([id], { includeHeld: true })).toEqual(expect.objectContaining({ feeds: 1, failedFeeds: 1 }));
  expect((await feedState(id))!.fail_count).toBe(4);

  // Refreshing the one feed by hand always tries, and success clears the backoff.
  mockFeedBodies[url] = rss([{ guid: 'd1', title: 'Back again', ageDays: 0 }]);
  expect((await refreshOne(id)).error).toBeNull();
  expect(await feedState(id)).toEqual({ fail_count: 0, retry_after: null });
});

it('counts connection failures only when other feeds got through', async () => {
  const gone = await insertFeed({ url: 'https://no-such-host.test/feed' });
  const fine = await insertFeed({ url: 'https://fine.test/feed' });
  mockFeedBodies['https://fine.test/feed'] = rss([{ guid: 'f1', title: 'Fine', ageDays: 0 }]);

  // Everything failing looks like being offline: nothing is held against the feed.
  await refreshFeeds([gone]);
  expect((await feedState(gone))!.fail_count).toBe(0);

  await refreshFeeds([gone, fine]);
  expect((await feedState(gone))!.fail_count).toBe(1);
  expect((await feedState(fine))!.fail_count).toBe(0);
});

it("honours a server's Retry-After", async () => {
  const url = 'https://busy.test/feed';
  const id = await insertFeed({ url });
  mockFeedBodies[url] = 429;
  await refreshFeeds([id]);
  const state = (await feedState(id))!;
  expect(state.retry_after).toBeGreaterThan(Date.now() + 100e3);
  expect(state.retry_after).toBeLessThan(Date.now() + 130e3);
});

it('rewrites seen keys only when they are more than a day old', async () => {
  const url = 'https://seen.test/feed';
  const id = await insertFeed({ url });
  mockFeedBodies[url] = rss([
    { guid: 's1', title: 'Seen one', ageDays: 0 },
    { guid: 's2', title: 'Seen two', ageDays: 0 },
  ]);
  await refreshFeeds([id]);
  const hourAgo = Date.now() - 3600e3;
  const twoDaysAgo = Date.now() - 2 * DAY;
  const keys = await db().getAllAsync<{ key_hash: string }>('SELECT key_hash FROM seen_items WHERE feed_id = ? ORDER BY key_hash', [id]);
  await db().runAsync('UPDATE seen_items SET last_seen_at = ? WHERE feed_id = ? AND key_hash = ?', [hourAgo, id, keys[0]!.key_hash]);
  await db().runAsync('UPDATE seen_items SET last_seen_at = ? WHERE feed_id = ? AND key_hash = ?', [twoDaysAgo, id, keys[1]!.key_hash]);

  await refreshFeeds([id]);
  const after = await db().getAllAsync<{ last_seen_at: number }>('SELECT last_seen_at FROM seen_items WHERE feed_id = ? ORDER BY key_hash', [id]);
  expect(after[0]!.last_seen_at).toBe(hourAgo);
  expect(after[1]!.last_seen_at).toBeGreaterThan(Date.now() - 60e3);
});

it('expires articles by arrival, keeping saved ones and each feed’s newest 20, and they stay gone', async () => {
  settings.set({ retentionDays: 30 });
  const url = 'https://old.test/feed';
  const feedId = await insertFeed({ url });
  const items = Array.from({ length: 24 }, (_, i) => ({ guid: `o${i}`, title: `Old ${i}`, ageDays: 40 + i }));
  mockFeedBodies[url] = rss(items);
  await refreshFeeds([feedId]);
  const mine = async () => (await listArticles({ kind: 'feed', feedId, hideRead: false }, 100)).map((a) => a.title);
  expect(await mine()).toHaveLength(24);
  // Just arrived: nothing expires yet, whatever the window.
  expect(await countExpired(7)).toBe(0);
  expect(await applyRetention()).toBe(0);

  // Forty days later the four oldest expire; the newest 20 stay, and so does a saved one.
  await db().runAsync('UPDATE articles SET fetched_at = fetched_at - ? WHERE feed_id = ?', [40 * DAY, feedId]);
  expect(await countExpired(30)).toBe(4);
  expect(await countExpired(0)).toBe(0);
  const saved = (await listArticles({ kind: 'feed', feedId, hideRead: false }, 100)).find((a) => a.title === 'Old 23')!;
  await setSaved(saved.id, true);
  expect(await countExpired(30)).toBe(3);
  expect(await applyRetention()).toBe(3);
  expect(await mine()).toEqual([...Array.from({ length: 20 }, (_, i) => `Old ${i}`), 'Old 23']);

  // The feed still lists them, but a refresh doesn't bring them back.
  expect((await refreshFeeds([feedId]))!.newArticles).toBe(0);
  expect(await mine()).toHaveLength(21);
});

describe('makeOffline', () => {
  const statusOf = (id: number) =>
    db().getFirstAsync<{ content_status: string; content_attempts: number; images_status: string; image_attempts: number }>(
      'SELECT content_status, content_attempts, images_status, image_attempts FROM articles WHERE id = ?',
      [id],
    );
  const bodyOf = async (id: number) =>
    (await db().getFirstAsync<{ content_html: string }>('SELECT content_html FROM article_bodies WHERE article_id = ?', [id]))!.content_html;

  let articleId = 0;
  beforeAll(async () => {
    const url = 'https://offline.test/feed';
    const feedId = await insertFeed({ url });
    mockFeedBodies[url] = rss([{ guid: 'm1', title: 'Make offline', ageDays: 0 }]);
    await refreshFeeds([feedId]);
    articleId = (await listArticles({ kind: 'feed', feedId, hideRead: false }, 1))[0]!.id;
  });

  it('keeps full text queued through connection failures, then gives up', async () => {
    await db().runAsync(`UPDATE articles SET content_status = 'pending', content_attempts = 0 WHERE id = ?`, [articleId]);
    // The article page (https://site.test/m1) isn't served: a connection failure.
    expect(await makeOffline(articleId, false)).toBe('unreachable');
    expect(await statusOf(articleId)).toEqual(expect.objectContaining({ content_status: 'pending', content_attempts: 1 }));

    // With no connection at all, nothing is used up.
    mockOnline = false;
    expect(await makeOffline(articleId, false)).toBe('unreachable');
    expect((await statusOf(articleId))!.content_attempts).toBe(1);
    mockOnline = true;

    for (let i = 0; i < 4; i++) await makeOffline(articleId, false);
    expect(await statusOf(articleId)).toEqual(expect.objectContaining({ content_status: 'failed', content_attempts: 5 }));
  });

  it('stores full text when the page yields a longer article', async () => {
    await db().runAsync(`UPDATE articles SET content_status = 'pending' WHERE id = ?`, [articleId]);
    mockFeedBodies['https://site.test/m1'] = '<html><body>page</body></html>';
    mockExtracted = { title: null, byline: null, content: `<p>${'full sentence here. '.repeat(400)}</p>`, length: 8000 };
    expect(await makeOffline(articleId, false)).toBe('full');
    expect((await statusOf(articleId))!.content_status).toBe('full');
    expect(await bodyOf(articleId)).toContain('full sentence here.');
    mockExtracted = null;
    delete mockFeedBodies['https://site.test/m1'];
  });

  it('localises images, but never over a body that changed meanwhile', async () => {
    const remote = 'https://img.test/a.png';
    const html = `<p><img src="${remote}" data-remote="${remote}"></p>`;
    const reset = async () => {
      await db().runAsync('UPDATE article_bodies SET content_html = ? WHERE article_id = ?', [html, articleId]);
      await db().runAsync(`UPDATE articles SET content_status = 'feed', images_status = 'pending', image_attempts = 0 WHERE id = ?`, [articleId]);
    };
    const localize = localizeImages as jest.Mock;

    await reset();
    localize.mockImplementationOnce(async () => {
      // Full text lands while the images download.
      await db().runAsync(`UPDATE article_bodies SET content_html = '<p>new body</p>' WHERE article_id = ?`, [articleId]);
      return ['images/1/a.png'];
    });
    await makeOffline(articleId, true);
    expect(await bodyOf(articleId)).toBe('<p>new body</p>');
    expect((await statusOf(articleId))!.images_status).toBe('pending');

    await reset();
    localize.mockImplementationOnce(async () => ['images/1/a.png']);
    await makeOffline(articleId, true);
    expect(await bodyOf(articleId)).toContain('src="images/1/a.png"');
    expect(await statusOf(articleId)).toEqual(expect.objectContaining({ images_status: 'done', image_attempts: 1 }));
  });

  it('does nothing offline, so retries are not used up', async () => {
    const remote = 'https://img.test/c.png';
    await db().runAsync('UPDATE article_bodies SET content_html = ? WHERE article_id = ?', [
      `<p><img src="${remote}" data-remote="${remote}"></p>`,
      articleId,
    ]);
    await db().runAsync(`UPDATE articles SET content_status = 'pending', content_attempts = 0, images_status = 'pending', image_attempts = 0 WHERE id = ?`, [articleId]);
    mockOnline = false;
    try {
      expect(await makeOffline(articleId, true)).toBe('unreachable');
      expect(await statusOf(articleId)).toEqual({ content_status: 'pending', content_attempts: 0, images_status: 'pending', image_attempts: 0 });
    } finally {
      mockOnline = true;
    }
  });

  it('retries partly downloaded images a few times', async () => {
    const remote = 'https://img.test/b.png';
    await db().runAsync('UPDATE article_bodies SET content_html = ? WHERE article_id = ?', [
      `<p><img src="${remote}" data-remote="${remote}"></p>`,
      articleId,
    ]);
    await db().runAsync(`UPDATE articles SET images_status = 'partial', image_attempts = 0 WHERE id = ?`, [articleId]);
    for (let i = 0; i < 5; i++) await makeOffline(articleId, true);
    expect(await statusOf(articleId)).toEqual(expect.objectContaining({ images_status: 'partial', image_attempts: 3 }));
  });
});
