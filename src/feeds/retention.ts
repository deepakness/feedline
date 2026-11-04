import { notifyChange } from '@/db/bus';
import { db, write } from '@/db/client';
import { settings } from '@/state/settings';

import { deleteArticleImages } from './images';

const DAY = 24 * 60 * 60 * 1000;

/** Oldest publish time a new item may have and still be inserted. */
export function retentionCutoff(now = Date.now()): number | null {
  const days = settings.get().retentionDays;
  return days ? now - days * DAY : null;
}

/** Each feed keeps at least this many of its newest articles, so a quiet blog never empties. */
export const KEEP_PER_FEED = 20;

/**
 * Articles a retention window removes: not saved, older than the window
 * counted from when they arrived (an old post just imported gets the full
 * window), and not among their feed's newest `KEEP_PER_FEED`.
 */
const EXPIRED = `SELECT id FROM articles
  WHERE is_saved = 0 AND MAX(published_at, fetched_at) < ?
    AND id NOT IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY feed_id ORDER BY published_at DESC, id DESC) AS rank FROM articles
      ) WHERE rank <= ${KEEP_PER_FEED}
    )`;

/** How many articles a `days` window would remove now. */
export async function countExpired(days: number, now = Date.now()): Promise<number> {
  if (!days) return 0;
  const row = await db().getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM (${EXPIRED})`, [now - days * DAY]);
  return row?.n ?? 0;
}

/**
 * Deletes expired articles (see `EXPIRED`), plus their images. `seen_items`
 * keeps their keys, so the next refresh will not bring them back.
 */
export async function applyRetention(now = Date.now()): Promise<number> {
  const days = settings.get().retentionDays;
  if (!days) return 0;
  const rows = await db().getAllAsync<{ id: number }>(EXPIRED, [now - days * DAY]);
  const ids = rows.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    await write((conn) => conn.runAsync(`DELETE FROM articles WHERE id IN (${chunk.map(() => '?').join(',')})`, chunk));
  }
  deleteArticleImages(ids);
  // Forget keys a feed stopped serving long ago; it can no longer re-add them.
  await write((conn) =>
    conn.runAsync('DELETE FROM seen_items WHERE last_seen_at < ?', [now - days * 2 * DAY]),
  );
  if (ids.length) notifyChange('articles');
  return ids.length;
}
