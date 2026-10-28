import { notifyChangeNow } from './bus';
import { db, write, writeTransaction } from './client';
import type { FeedRow, FeedSummary, FullTextMode } from './types';

export const FEED_NAME_SQL = `COALESCE(f.custom_title, NULLIF(f.title, ''), f.url)`;

export function listFeedSummaries(): Promise<FeedSummary[]> {
  return db().getAllAsync<FeedSummary>(
    `SELECT f.id, f.url, f.site_url, ${FEED_NAME_SQL} AS name, f.icon_path,
       f.last_success_at, f.last_error,
       (SELECT COUNT(*) FROM articles a WHERE a.feed_id = f.id AND a.is_read = 0) AS unread,
       (SELECT COUNT(*) FROM articles a WHERE a.feed_id = f.id) AS total
     FROM feeds f ORDER BY ${FEED_NAME_SQL} COLLATE NOCASE`,
  );
}

export function listFeeds(): Promise<FeedRow[]> {
  return db().getAllAsync<FeedRow>('SELECT * FROM feeds ORDER BY id');
}

export function getFeed(id: number): Promise<FeedRow | null> {
  return db().getFirstAsync<FeedRow>('SELECT * FROM feeds WHERE id = ?', [id]);
}

export function findFeedByUrl(url: string): Promise<FeedRow | null> {
  return db().getFirstAsync<FeedRow>('SELECT * FROM feeds WHERE url = ?', [url]);
}

export async function feedUrlSet(): Promise<Set<string>> {
  const rows = await db().getAllAsync<{ url: string }>('SELECT url FROM feeds');
  return new Set(rows.map((r) => r.url));
}

export async function insertFeed(input: {
  url: string;
  title?: string;
  siteUrl?: string | null;
}): Promise<number> {
  const result = await write((conn) =>
    conn.runAsync(
      `INSERT INTO feeds (url, title, site_url, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(url) DO NOTHING`,
      [input.url, input.title ?? '', input.siteUrl ?? null, Date.now()],
    ),
  );
  notifyChangeNow('feeds');
  if (result.changes) return result.lastInsertRowId;
  const existing = await findFeedByUrl(input.url);
  return existing!.id;
}

/** Bulk insert for OPML import; returns the ids of newly created feeds. */
export async function insertFeeds(
  feeds: { url: string; title: string; siteUrl: string | null }[],
): Promise<number[]> {
  const ids: number[] = [];
  await writeTransaction(async (conn) => {
    const now = Date.now();
    for (const f of feeds) {
      const r = await conn.runAsync(
        `INSERT INTO feeds (url, title, site_url, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(url) DO NOTHING`,
        [f.url, f.title, f.siteUrl, now],
      );
      if (r.changes) ids.push(r.lastInsertRowId);
    }
  });
  notifyChangeNow('feeds');
  return ids;
}

export async function renameFeed(id: number, title: string | null) {
  await write((conn) =>
    conn.runAsync('UPDATE feeds SET custom_title = ? WHERE id = ?', [title?.trim() || null, id]),
  );
  notifyChangeNow('feeds', 'articles');
}

export async function setFullTextMode(id: number, mode: FullTextMode) {
  await write((conn) => conn.runAsync('UPDATE feeds SET full_text_mode = ? WHERE id = ?', [mode, id]));
  notifyChangeNow('feeds');
}

export async function deleteFeed(id: number): Promise<number[]> {
  const rows = await db().getAllAsync<{ id: number }>('SELECT id FROM articles WHERE feed_id = ?', [id]);
  await write((conn) => conn.runAsync('DELETE FROM feeds WHERE id = ?', [id]));
  notifyChangeNow('feeds', 'articles');
  return rows.map((r) => r.id);
}
