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

/**
 * Deletes non-saved articles older than the retention window, plus their images.
 * `seen_items` keeps their keys, so the next refresh will not bring them back.
 */
export async function applyRetention(now = Date.now()): Promise<number> {
  const days = settings.get().retentionDays;
  if (!days) return 0;
  const cutoff = now - days * DAY;
  const rows = await db().getAllAsync<{ id: number }>(
    'SELECT id FROM articles WHERE is_saved = 0 AND published_at < ?',
    [cutoff],
  );
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
