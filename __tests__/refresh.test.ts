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

import { listArticles, searchArticles } from '@/db/articles';
import { db, getDb } from '@/db/client';
import { getFeed, insertFeed } from '@/db/feeds';
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
