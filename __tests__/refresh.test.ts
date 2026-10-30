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
jest.mock('@/extract/extractor', () => ({ extractArticle: async () => null }));
jest.mock('@/feeds/images', () => ({
  imageDownloadsAllowed: async () => false,
  localizeImages: async () => [],
  localizeThumb: async () => null,
  downloadIcon: async () => null,
  deleteArticleImages: jest.fn(),
}));
jest.mock('@/feeds/discover', () => ({ findSiteIcon: async () => null }));

const mockNotModified = '\u0000304';
const mockFeedBodies: Record<string, string> = {};
jest.mock('@/feeds/fetch', () => ({
  HTML_ACCEPT: '',
  fetchText: async (url: string) => {
    const body = mockFeedBodies[url];
    if (body === undefined) throw new Error('Network unavailable');
    if (body === mockNotModified) return { status: 'not-modified' };
    return { status: 'ok', url, body, contentType: 'application/rss+xml', etag: null, lastModified: null };
  },
}));

import { listArticles, markAllRead, searchArticles, setRead, setSaved } from '@/db/articles';
import { db, getDb } from '@/db/client';
import { getFeed, insertFeed, sortFeeds } from '@/db/feeds';
import type { FeedSummary } from '@/db/types';
import { refreshFeeds } from '@/feeds/refresh';
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

it('inserts new items, dedupes on refresh, and never re-adds items removed by retention', async () => {
  const url = 'https://site.test/feed';
  const id = await insertFeed({ url });
  mockFeedBodies[url] = rss([
    { guid: 'a', title: 'Fresh one', ageDays: 1, body: 'The quick zebra jumps' },
    { guid: 'b', title: 'Fresh two', ageDays: 8 },
    { guid: 'old', title: 'Too old to keep', ageDays: 45 },
  ]);

  const first = await refreshFeeds();
  expect(first).toEqual(expect.objectContaining({ newArticles: 2, failedFeeds: 0 }));
  expect((await all()).map((a) => a.title)).toEqual(['Fresh one', 'Fresh two']);
  expect((await getFeed(id))!.title).toBe('Test Feed');

  // Same items again: nothing new.
  expect((await refreshFeeds())!.newArticles).toBe(0);
  expect(await all()).toHaveLength(2);

  // Search finds content via the FTS triggers.
  expect((await searchArticles('zebr')).map((h) => h.title)).toEqual(['Fresh one']);

  // Shrink retention so "Fresh two" (8 days old) expires; the feed still lists it,
  // but it must not come back.
  settings.set({ retentionDays: 7 });
  mockFeedBodies[url] = rss([
    { guid: 'a', title: 'Fresh one', ageDays: 1 },
    { guid: 'b', title: 'Fresh two', ageDays: 8 },
    { guid: 'c', title: 'Brand new', ageDays: 0 },
  ]);
  const third = await refreshFeeds();
  expect(third!.newArticles).toBe(1);
  expect((await all()).map((a) => a.title).sort()).toEqual(['Brand new', 'Fresh one']);
  expect(await refreshFeeds()).toEqual(expect.objectContaining({ newArticles: 0 }));
  expect(await all()).toHaveLength(2);
});

it('records failures per feed without affecting others', async () => {
  const id = await insertFeed({ url: 'https://down.test/feed' });
  const summary = await refreshFeeds();
  expect(summary!.failedFeeds).toBe(1);
  expect((await getFeed(id))!.last_error).toBe('Network unavailable');
});

it('keeps only the newest items from a newly added feed, and never adds the rest later', async () => {
  const url = 'https://big.test/feed';
  const id = await insertFeed({ url });
  const items = Array.from({ length: 40 }, (_, i) => ({ guid: `big${i}`, title: `Big ${i}`, ageDays: i * 0.1 }));
  mockFeedBodies[url] = rss(items);
  await refreshFeeds([id]);
  const mine = () => listArticles({ kind: 'feed', feedId: id, hideRead: false }, 1000);
  const first = await mine();
  expect(first).toHaveLength(25);
  expect(first[0]!.title).toBe('Big 0');
  await refreshFeeds([id]);
  expect(await mine()).toHaveLength(25);
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
