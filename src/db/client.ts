import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import { createMutex } from '@/lib/pool';

import { MIGRATIONS } from './migrations';

let dbPromise: Promise<SQLiteDatabase> | null = null;
let dbInstance: SQLiteDatabase | null = null;

async function open(): Promise<SQLiteDatabase> {
  const db = await openDatabaseAsync('feedline.db');
  // Connection settings must be applied outside the migration transaction.
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;');
  await migrate(db);
  dbInstance = db;
  return db;
}

async function migrate(db: SQLiteDatabase) {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  if (current > MIGRATIONS.length) {
    throw new Error('Database schema is newer than this app supports');
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(MIGRATIONS[v]!);
      await db.execAsync(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

export function getDb(): Promise<SQLiteDatabase> {
  dbPromise ??= open();
  return dbPromise;
}

/** Synchronous handle, valid after the root layout has awaited `getDb()`. */
export function db(): SQLiteDatabase {
  if (!dbInstance) throw new Error('Database used before initialization');
  return dbInstance;
}

/**
 * All multi-statement writes go through this lock. `withTransactionAsync` lets any
 * concurrent query on the connection join the open transaction, so serializing
 * writers keeps one feed's failed upsert from rolling back another's work.
 */
const writeLock = createMutex();

export function writeTransaction<T>(task: (db: SQLiteDatabase) => Promise<T>): Promise<T> {
  return writeLock(async () => {
    const conn = db();
    let result!: T;
    await conn.withTransactionAsync(async () => {
      result = await task(conn);
    });
    return result;
  });
}

/** Single statements also take the lock so they never land inside someone else's transaction. */
export function write<T>(task: (db: SQLiteDatabase) => Promise<T>): Promise<T> {
  return writeLock(() => task(db()));
}
