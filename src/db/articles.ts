import { notifyChangeNow } from './bus';
import { db, write } from './client';
import type { ArticleFilter, ArticleFull, ArticleListItem } from './types';

const LIST_COLUMNS = `
  a.id, a.feed_id, COALESCE(f.custom_title, NULLIF(f.title, ''), f.url) AS feed_name,
  f.icon_path AS feed_icon, a.url, a.title, a.excerpt, a.thumb_path, a.published_at,
  a.reading_minutes, a.is_read, a.is_saved, a.images_status`;

function whereFor(filter: ArticleFilter): { sql: string; params: (string | number)[] } {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (filter.kind === 'saved') clauses.push('a.is_saved = 1');
  if (filter.kind === 'feed') {
    clauses.push('a.feed_id = ?');
    params.push(filter.feedId);
  }
  if (filter.hideRead && filter.keepReadSince != null) {
    clauses.push('(a.is_read = 0 OR a.read_at >= ?)');
    params.push(filter.keepReadSince);
  } else if (filter.hideRead) clauses.push('a.is_read = 0');
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

export function listArticles(filter: ArticleFilter, limit: number): Promise<ArticleListItem[]> {
  const where = whereFor(filter);
  const order = filter.kind === 'saved' ? 'a.saved_at DESC' : 'a.published_at DESC, a.id DESC';
  return db().getAllAsync<ArticleListItem>(
    `SELECT ${LIST_COLUMNS} FROM articles a JOIN feeds f ON f.id = a.feed_id
     ${where.sql} ORDER BY ${order} LIMIT ?`,
    [...where.params, limit],
  );
}

export async function countArticles(filter: ArticleFilter): Promise<{ total: number; unread: number }> {
  const where = whereFor({ ...filter, hideRead: false });
  const row = await db().getFirstAsync<{ total: number; unread: number }>(
    `SELECT COUNT(*) AS total, COALESCE(SUM(a.is_read = 0), 0) AS unread
     FROM articles a ${where.sql}`,
    where.params,
  );
  return row ?? { total: 0, unread: 0 };
}

export function getArticle(id: number): Promise<ArticleFull | null> {
  return db().getFirstAsync<ArticleFull>(
    `SELECT ${LIST_COLUMNS}, a.author, b.content_html, a.content_status,
       f.site_url AS feed_site_url, f.full_text_mode
     FROM articles a JOIN feeds f ON f.id = a.feed_id
     LEFT JOIN article_bodies b ON b.article_id = a.id
     WHERE a.id = ?`,
    [id],
  );
}

export async function setRead(ids: number[], read: boolean) {
  if (!ids.length) return;
  await write((conn) =>
    conn.runAsync(
      `UPDATE articles SET is_read = ?, read_at = ? WHERE id IN (${ids.map(() => '?').join(',')}) AND is_read != ?`,
      [read ? 1 : 0, read ? Date.now() : null, ...ids, read ? 1 : 0],
    ),
  );
  notifyChangeNow('articles');
}

export async function setSaved(id: number, saved: boolean) {
  await write((conn) =>
    conn.runAsync('UPDATE articles SET is_saved = ?, saved_at = ? WHERE id = ?', [
      saved ? 1 : 0,
      saved ? Date.now() : null,
      id,
    ]),
  );
  notifyChangeNow('articles');
}

/**
 * Marks every unread article in `filter` as read, optionally only those published
 * at or before `beforeTs`. Returns the ids changed so the caller can offer undo.
 */
export async function markAllRead(filter: ArticleFilter, beforeTs?: number): Promise<number[]> {
  const where = whereFor({ ...filter, hideRead: true, keepReadSince: undefined });
  const extra = beforeTs != null ? ' AND a.published_at <= ?' : '';
  const params = beforeTs != null ? [...where.params, beforeTs] : where.params;
  const rows = await db().getAllAsync<{ id: number }>(
    `SELECT a.id FROM articles a ${where.sql}${extra}`,
    params,
  );
  const ids = rows.map((r) => r.id);
  // Chunk to stay under SQLite's bound-parameter limit.
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    await write((conn) =>
      conn.runAsync(
        `UPDATE articles SET is_read = 1, read_at = ? WHERE id IN (${chunk.map(() => '?').join(',')})`,
        [Date.now(), ...chunk],
      ),
    );
  }
  notifyChangeNow('articles');
  return ids;
}

export async function markUnread(ids: number[]) {
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    await write((conn) =>
      conn.runAsync(
        `UPDATE articles SET is_read = 0, read_at = NULL WHERE id IN (${chunk.map(() => '?').join(',')})`,
        chunk,
      ),
    );
  }
  notifyChangeNow('articles');
}

export type SearchHit = ArticleListItem & { snippet: string };

/** Builds a safe FTS5 query: each word becomes a quoted prefix term, all required. */
export function toFtsQuery(input: string): string | null {
  const terms = input
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    // A one-letter prefix matches most of the library and is slow to rank.
    .filter((t) => t.length > 1)
    .slice(0, 8);
  if (!terms.length) return null;
  return terms.map((t) => `"${t}"*`).join(' ');
}

/** `filter` narrows the search to one feed or to Saved; read state is ignored. */
export function searchArticles(input: string, filter?: ArticleFilter, limit = 100): Promise<SearchHit[]> {
  const query = toFtsQuery(input);
  if (!query) return Promise.resolve([]);
  const scope = filter ? whereFor({ ...filter, hideRead: false }) : { sql: '', params: [] };
  return db().getAllAsync<SearchHit>(
    `SELECT ${LIST_COLUMNS},
       snippet(articles_fts, 2, '\u0001', '\u0002', '…', 18) AS snippet
     FROM articles_fts
     JOIN articles a ON a.id = articles_fts.rowid
     JOIN feeds f ON f.id = a.feed_id
     WHERE articles_fts MATCH ?${scope.sql.replace(/^WHERE/, ' AND')}
     ORDER BY bm25(articles_fts, 8.0, 2.0, 1.0)
     LIMIT ?`,
    [query, ...scope.params, limit],
  );
}
