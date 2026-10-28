import { DatabaseSync } from 'node:sqlite';

import { MIGRATIONS } from '@/db/migrations';

it('moves bodies out of articles without losing data or search', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(MIGRATIONS[0]!);
  db.exec(`INSERT INTO feeds (id, url, created_at) VALUES (1, 'https://f.test', 0)`);
  db.exec(`INSERT INTO articles (id, feed_id, key_hash, title, content_html, content_text, published_at, fetched_at, is_read)
           VALUES (7, 1, 'k', 'Otters', '<p>Sea otters hold hands</p>', 'Sea otters hold hands', 1, 1, 1)`);

  db.exec('BEGIN');
  for (const m of MIGRATIONS.slice(1)) db.exec(m);
  db.exec('COMMIT');

  const cols = (db.prepare('PRAGMA table_info(articles)').all() as { name: string }[]).map((c) => c.name);
  expect(cols).not.toContain('content_html');
  expect(db.prepare('SELECT is_read, title FROM articles WHERE id = 7').get()).toEqual({ is_read: 1, title: 'Otters' });
  expect(db.prepare('SELECT content_html FROM article_bodies WHERE article_id = 7').get()).toEqual({
    content_html: '<p>Sea otters hold hands</p>',
  });
  const hit = () => db.prepare(`SELECT rowid FROM articles_fts WHERE articles_fts MATCH ?`).all('"hands"*');
  expect(hit()).toEqual([{ rowid: 7 }]);

  // Triggers keep the index in step with both tables.
  db.exec(`UPDATE article_bodies SET content_text = 'Kelp forests' WHERE article_id = 7`);
  expect(hit()).toEqual([]);
  db.exec(`UPDATE articles SET title = 'Hands up' WHERE id = 7`);
  expect(hit()).toEqual([{ rowid: 7 }]);
  db.exec('DELETE FROM articles WHERE id = 7');
  expect(hit()).toEqual([]);
  expect(db.prepare('SELECT COUNT(*) AS n FROM article_bodies').get()).toEqual({ n: 0 });
  expect(db.prepare(`INSERT INTO articles_fts (articles_fts) VALUES ('integrity-check')`).run()).toBeTruthy();
});
