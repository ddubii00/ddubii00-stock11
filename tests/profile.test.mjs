import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { applyOperation, parseOperation, restoreProfile } from '../lib/profile.ts';
import { readProfile, updateProfile, login, authenticated, logout } from '../lib/profile-service.ts';
import { checkOrigin, jsonBody, sessionCookie, tokenFrom } from '../lib/profile-http.ts';
import { redisKey, closeRedis, getRedis } from '../lib/redis.ts';
import { syncConfiguration } from '../lib/profile-store.ts';
import { GET as health } from '../app/api/health/redis/route.ts';
import { GET as getProfile, PATCH as patchProfile } from '../app/api/profile/route.ts';
import { POST as postSession } from '../app/api/session/route.ts';

function memoryStore() {
  const data = new Map();
  return { data, async get(key) { return data.get(key)?.value ?? null; },
    async cas(key, previous, next, ttl = 0) { if ((data.get(key)?.value ?? null) !== previous) return false; data.set(key, { value: next, ttl }); return true; },
    async remove(key) { data.delete(key); } };
}
const samsung = { market: 'KOSPI', code: '005930', chartCode: '005930', name: '삼성전자' };
const qqq = { market: 'NASDAQ', code: 'QQQ', chartCode: 'QQQ.O', name: 'Invesco QQQ Trust', instrumentType: 'etf' };

void test('precise atomic operations preserve concurrent additions, colors, order and settings; retries are idempotent', async () => {
  const store = memoryStore(), ns = 'stock11:user:personal';
  await Promise.all([updateProfile(store, ns, randomUUID(), { type: 'add', item: samsung }), updateProfile(store, ns, randomUUID(), { type: 'add', item: qqq })]);
  await Promise.all([updateProfile(store, ns, randomUUID(), { type: 'highlight', key: 'KOSPI:005930', color: 'yellow' }), updateProfile(store, ns, randomUUID(), { type: 'settings', largeText: false })]);
  const id = randomUUID(), move = { type: 'move', key: 'NASDAQ:QQQ.O', before: 'KOSPI:005930' };
  const moved = await updateProfile(store, ns, id, move);
  assert.equal(moved.watchlist[0].code, 'QQQ');
  assert.equal(moved.settings.largeText, false);
  assert.deepEqual(moved.highlights, [['KOSPI:005930', 'yellow']]);
  assert.deepEqual(await updateProfile(store, ns, id, move), moved);
  assert.equal(store.data.get(`${ns}:state`).ttl, 0);
  await updateProfile(store, ns, randomUUID(), { type: 'remove', key: 'KOSPI:005930' });
  await updateProfile(store, ns, randomUUID(), { type: 'highlight', key: 'NASDAQ:QQQ.O', color: 'red' });
  assert.deepEqual((await readProfile(store, ns)).watchlist.map((item) => item.code), ['QQQ']);
  assert.equal((await readProfile(store, 'stock11:user:another')).watchlist.length, 0);
});

void test('one-time migration never overwrites an existing server record and rejects invalid payloads', async () => {
  const store = memoryStore(), ns = 'stock11:user:migration';
  const op = parseOperation({ type: 'import', watchlist: [qqq, samsung], highlights: [['NASDAQ:QQQ.O', 'red']], largeText: false });
  const profile = await updateProfile(store, ns, randomUUID(), op);
  assert.equal(profile.watchlist[0].instrumentType, 'etf');
  assert.equal(profile.settings.largeText, false);
  await assert.rejects(updateProfile(store, ns, randomUUID(), op), /이미 서버 기록/);
  for (const bad of [null, { type: 'flushall' }, { type: 'highlight', key: 'stock11:system:x', color: 'red' }, { type: 'highlight', key: 'KOSPI:005930', color: 'url(x)' }, { type: 'settings', largeText: 'false' }]) assert.throws(() => parseOperation(bad));
  assert.equal(restoreProfile({ ...profile, revision: -1 }), null);
  assert.equal(restoreProfile({ ...profile, settings: { password: 'not-allowed' } }), null);
  assert.deepEqual(restoreProfile(profile), profile);
  assert.deepEqual(applyOperation(profile, { type: 'highlight', key: 'NASDAQ:QQQ.O', color: null }).highlights, []);
});

void test('password login is rate-limited, sessions expire/rotate/revoke and no token stores plaintext passwords', async () => {
  const store = memoryStore(), ns = 'stock11:user:auth', password = 'test-only-long-password';
  await assert.rejects(login(store, ns, password, 'wrong'), /비밀번호/);
  const token = await login(store, ns, password, password);
  assert.equal(await authenticated(store, ns, password, token), true);
  assert.equal(await authenticated(store, `${ns}-other`, password, token), false);
  assert.equal(await authenticated(store, ns, `${password}-changed`, token), false);
  assert.equal(JSON.stringify([...store.data]).includes(password), false);
  await logout(store, ns, token);
  assert.equal(await authenticated(store, ns, password, token), false);
  for (let i = 0; i < 20; i++) await login(store, 'stock11:user:limit', password, 'wrong').catch(() => {});
  await assert.rejects(login(store, 'stock11:user:limit', password, password), (error) => error.status === 429);
});

void test('CSRF, request size, cookie security and unauthenticated routes fail closed without leaking credentials', async () => {
  const previous = { ...process.env };
  try {
    process.env.REDIS_URL = 'redis://test-user:credential-must-not-leak@127.0.0.1:1';
    process.env.STOCK11_SYNC_PASSWORD = 'test-only-long-password';
    process.env.STOCK11_SYNC_ORIGIN = 'https://stock.example';
    delete process.env.STOCK11_SYNC_ENABLED;
    const request = new Request('https://stock.example/api/profile');
    assert.equal((await getProfile(request)).status, 401);
    assert.equal((await patchProfile(new Request(request, { method: 'PATCH', body: '{}' }))).status, 401);
    const badOrigin = await postSession(new Request('https://stock.example/api/session', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{"password":"bad"}' }));
    assert.equal(badOrigin.status, 403);
    assert.throws(() => checkOrigin(new Request('https://stock.example/api/profile', { headers: { origin: 'https://evil.example' } }), 'https://stock.example'));
    await assert.rejects(jsonBody(new Request('https://stock.example', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(100) }), 20), (error) => error.status === 413);
    await assert.rejects(jsonBody(new Request('https://stock.example', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })), (error) => error.status === 400);
    const cookie = sessionCookie('personal', 'a'.repeat(64), true);
    assert.match(cookie, /HttpOnly; SameSite=Strict/); assert.match(cookie, /Secure/);
    assert.equal(tokenFrom(new Request('https://stock.example', { headers: { cookie } }), 'personal'), 'a'.repeat(64));
    delete process.env.REDIS_URL;
    assert.equal(syncConfiguration(), null);
    const result = await health();
    assert.equal(result.status, 503); assert.deepEqual(await result.json(), { ok: false, redis: 'unavailable' });
    await assert.rejects(getRedis(), /^Error: Redis unavailable$/);
    process.env.REDIS_URL = 'not-a-url-with-credential';
    await assert.rejects(getRedis(), /^Error: Redis unavailable$/);
    delete process.env.STOCK11_SYNC_PASSWORD;
    assert.equal(syncConfiguration(), null);
    assert.equal(redisKey('user', 'personal', 'state'), 'stock11:user:personal:state');
    assert.throws(() => redisKey('user', '../bad'));
  } finally {
    closeRedis();
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});
