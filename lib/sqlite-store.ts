import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Store } from './profile-store';

type Row = { value: string; expires_at: number | null };
type CachedDatabase = { path: string; database: DatabaseSync };
const globalDatabase = globalThis as typeof globalThis & { __stock11ProfileDatabase?: CachedDatabase };

function databasePath() {
  const configured = process.env.STOCK11_SQLITE_PATH || '/app/data/stock11-profile.sqlite';
  return configured === ':memory:' ? configured : resolve(configured);
}

function openDatabase() {
  if (typeof window !== 'undefined') throw new Error('Server storage is server-only');
  const path = databasePath();
  const cached = globalDatabase.__stock11ProfileDatabase;
  if (cached?.path === path) return cached.database;
  if (cached) cached.database.close();
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try {
    const database = new DatabaseSync(path);
    database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS stock11_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER) WITHOUT ROWID;');
    globalDatabase.__stock11ProfileDatabase = { path, database };
    return database;
  } catch {
    throw new Error('Server storage unavailable');
  }
}

function currentValue(database: DatabaseSync, key: string) {
  const row = database.prepare('SELECT value, expires_at FROM stock11_kv WHERE key = ?').get(key) as Row | undefined;
  if (!row) return null;
  if (row.expires_at !== null && row.expires_at <= Date.now()) {
    database.prepare('DELETE FROM stock11_kv WHERE key = ?').run(key);
    return null;
  }
  return row.value;
}

export function sqliteStore(): Store {
  return {
    async get(key) {
      try { return currentValue(openDatabase(), key); }
      catch { throw new Error('Server storage unavailable'); }
    },
    async cas(key, previous, next, ttl = 0) {
      const database = openDatabase();
      try {
        database.exec('BEGIN IMMEDIATE');
        const value = currentValue(database, key);
        if (value !== previous) { database.exec('ROLLBACK'); return false; }
        const expiresAt = ttl > 0 ? Date.now() + ttl * 1000 : null;
        database.prepare('INSERT INTO stock11_kv (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at').run(key, next, expiresAt);
        database.exec('COMMIT');
        return true;
      } catch {
        try { database.exec('ROLLBACK'); } catch { /* Transaction may not have started. */ }
        throw new Error('Server storage unavailable');
      }
    },
    async remove(key) {
      try { openDatabase().prepare('DELETE FROM stock11_kv WHERE key = ?').run(key); }
      catch { throw new Error('Server storage unavailable'); }
    },
  };
}

export function closeSqliteStore() {
  const cached = globalDatabase.__stock11ProfileDatabase;
  if (cached) cached.database.close();
  globalDatabase.__stock11ProfileDatabase = undefined;
}
