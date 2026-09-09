import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeSqliteStore, sqliteStore } from '../lib/sqlite-store.ts';

void test('Oracle SQLite store persists values, compares atomically and removes sessions', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'stock11-sqlite-'));
  const originalPath = process.env.STOCK11_SQLITE_PATH;
  process.env.STOCK11_SQLITE_PATH = join(directory, 'profile.sqlite');
  try {
    let store = sqliteStore();
    assert.equal(await store.get('stock11:user:personal:state'), null);
    assert.equal(await store.cas('stock11:user:personal:state', null, 'first'), true);
    assert.equal(await store.cas('stock11:user:personal:state', null, 'lost'), false);
    assert.equal(await store.cas('stock11:user:personal:state', 'first', 'second'), true);
    closeSqliteStore();

    store = sqliteStore();
    assert.equal(await store.get('stock11:user:personal:state'), 'second');
    assert.equal(await store.cas('stock11:system:session:test', null, 'session', 60), true);
    assert.equal(await store.get('stock11:system:session:test'), 'session');
    await store.remove('stock11:system:session:test');
    assert.equal(await store.get('stock11:system:session:test'), null);
  } finally {
    closeSqliteStore();
    if (originalPath === undefined) delete process.env.STOCK11_SQLITE_PATH;
    else process.env.STOCK11_SQLITE_PATH = originalPath;
    rmSync(directory, { recursive: true, force: true });
  }
});
