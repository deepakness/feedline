/**
 * Ordered schema migrations; index + 1 is the resulting `PRAGMA user_version`.
 * Never edit a shipped entry. Append a new one instead.
 */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE feeds (
    id INTEGER PRIMARY KEY NOT NULL,
    url TEXT NOT NULL UNIQUE,
    site_url TEXT,
    title TEXT NOT NULL DEFAULT '',
    custom_title TEXT,
    description TEXT,
    icon_path TEXT,
    icon_remote TEXT,
    etag TEXT,
    last_modified TEXT,
    last_fetched_at INTEGER,
    last_success_at INTEGER,
    last_error TEXT,
    full_text_mode TEXT NOT NULL DEFAULT 'auto',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE articles (
    id INTEGER PRIMARY KEY NOT NULL,
    feed_id INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
    key_hash TEXT NOT NULL,
    url TEXT,
    title TEXT NOT NULL DEFAULT '',
    author TEXT,
    excerpt TEXT NOT NULL DEFAULT '',
    content_html TEXT,
    content_text TEXT NOT NULL DEFAULT '',
    thumb_path TEXT,
    thumb_remote TEXT,
    published_at INTEGER NOT NULL,
    fetched_at INTEGER NOT NULL,
    content_status TEXT NOT NULL DEFAULT 'pending',
    images_status TEXT NOT NULL DEFAULT 'pending',
    reading_minutes INTEGER NOT NULL DEFAULT 1,
    is_read INTEGER NOT NULL DEFAULT 0,
    read_at INTEGER,
    is_saved INTEGER NOT NULL DEFAULT 0,
    saved_at INTEGER,
    UNIQUE (feed_id, key_hash)
  );
  CREATE INDEX articles_published ON articles (published_at DESC);
  CREATE INDEX articles_feed_published ON articles (feed_id, published_at DESC);
  CREATE INDEX articles_saved ON articles (is_saved) WHERE is_saved = 1;
  CREATE INDEX articles_unread ON articles (feed_id) WHERE is_read = 0;
  CREATE INDEX articles_pending ON articles (content_status, images_status);

  -- Keys of every item a feed has served, so articles removed by retention are
  -- never re-inserted while the feed still lists them.
  CREATE TABLE seen_items (
    feed_id INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
    key_hash TEXT NOT NULL,
    last_seen_at INTEGER NOT NULL,
    PRIMARY KEY (feed_id, key_hash)
  ) WITHOUT ROWID;

  CREATE VIRTUAL TABLE articles_fts USING fts5(
    title, author, content_text,
    content = 'articles', content_rowid = 'id',
    tokenize = 'unicode61 remove_diacritics 2'
  );
  CREATE TRIGGER articles_ai AFTER INSERT ON articles BEGIN
    INSERT INTO articles_fts (rowid, title, author, content_text)
    VALUES (new.id, new.title, new.author, new.content_text);
  END;
  CREATE TRIGGER articles_ad AFTER DELETE ON articles BEGIN
    INSERT INTO articles_fts (articles_fts, rowid, title, author, content_text)
    VALUES ('delete', old.id, old.title, old.author, old.content_text);
  END;
  CREATE TRIGGER articles_au AFTER UPDATE OF title, author, content_text ON articles BEGIN
    INSERT INTO articles_fts (articles_fts, rowid, title, author, content_text)
    VALUES ('delete', old.id, old.title, old.author, old.content_text);
    INSERT INTO articles_fts (rowid, title, author, content_text)
    VALUES (new.id, new.title, new.author, new.content_text);
  END;
  `,
  // Article bodies move to their own table. Stored inline, every list, count and
  // read-flag update had to walk each row's overflow pages to reach the small
  // columns, which with thousands of articles starved the UI's queries.
  `
  DROP TRIGGER articles_ai;
  DROP TRIGGER articles_ad;
  DROP TRIGGER articles_au;
  DROP TABLE articles_fts;
  DROP INDEX articles_pending;

  CREATE TABLE article_bodies (
    article_id INTEGER PRIMARY KEY NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    content_html TEXT,
    content_text TEXT NOT NULL DEFAULT ''
  );
  INSERT INTO article_bodies (article_id, content_html, content_text)
    SELECT id, content_html, content_text FROM articles;
  ALTER TABLE articles DROP COLUMN content_html;
  ALTER TABLE articles DROP COLUMN content_text;

  CREATE INDEX articles_content_pending ON articles (published_at DESC) WHERE content_status = 'pending';
  CREATE INDEX articles_images_pending ON articles (published_at DESC) WHERE images_status = 'pending';

  -- A self-contained index (rowid = article id) kept in step by triggers on both tables.
  CREATE VIRTUAL TABLE articles_fts USING fts5(
    title, author, content_text,
    tokenize = 'unicode61 remove_diacritics 2'
  );
  INSERT INTO articles_fts (rowid, title, author, content_text)
    SELECT a.id, a.title, a.author, b.content_text
    FROM articles a JOIN article_bodies b ON b.article_id = a.id;

  CREATE TRIGGER article_bodies_ai AFTER INSERT ON article_bodies BEGIN
    INSERT INTO articles_fts (rowid, title, author, content_text)
    SELECT a.id, a.title, a.author, new.content_text FROM articles a WHERE a.id = new.article_id;
  END;
  CREATE TRIGGER article_bodies_au AFTER UPDATE OF content_text ON article_bodies BEGIN
    UPDATE articles_fts SET content_text = new.content_text WHERE rowid = new.article_id;
  END;
  CREATE TRIGGER articles_au AFTER UPDATE OF title, author ON articles BEGIN
    UPDATE articles_fts SET title = new.title, author = new.author WHERE rowid = new.id;
  END;
  CREATE TRIGGER articles_ad AFTER DELETE ON articles BEGIN
    DELETE FROM articles_fts WHERE rowid = old.id;
  END;
  `,
];
