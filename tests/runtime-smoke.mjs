// Isolated production-server tests. Mock ticks never enter the user's preview.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import '../scripts/prepare-standalone.mjs';

const children = new Set();
const servers = new Set();
async function stop(child) {
  if (child.exitCode !== null) { children.delete(child); return; }
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
  await exited;
  clearTimeout(timeout); children.delete(child);
}
async function listen(server) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); servers.add(server);
  return `http://127.0.0.1:${server.address().port}`;
}
async function start(script, env = {}) {
  const reserve = createServer(); await listen(reserve);
  const port = reserve.address().port;
  await new Promise((resolve) => reserve.close(resolve)); servers.delete(reserve);
  const origin = `http://127.0.0.1:${port}`;
  const runtimeEnv = { ...env };
  if (runtimeEnv.STOCK11_SYNC_ORIGIN === '__TEST_ORIGIN__') runtimeEnv.STOCK11_SYNC_ORIGIN = origin;
  const child = spawn(process.execPath, [script], { env: {
    ...process.env, NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: String(port),
    KIS_APP_KEY: '', KIS_APP_SECRET: '', KIS_RELAY_PORT: String(port), KIS_RELAY_HOST: '127.0.0.1',
    REDIS_URL: '', STOCK11_SYNC_PASSWORD: '', STOCK11_SYNC_ENABLED: 'true',
    STOCK11_PROFILE_STORE: '', STOCK11_SQLITE_PATH: '', STOCK11_SYNC_ORIGIN: '',
    VERCEL: '', STOCK11_DATA_PROVIDER: 'naver', ...runtimeEnv,
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  let output = ''; child.stdout.on('data', (value) => { output += value; }); child.stderr.on('data', (value) => { output += value; });
  const health = script.includes('kis-relay') ? '/health' : '/api/health';
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Server exited: ${output}`);
    try { if ((await fetch(origin + health, { signal: AbortSignal.timeout(1000) })).ok) return { child, origin }; } catch { /* Startup only. */ }
    await delay(200);
  }
  throw new Error(`Server startup timeout: ${output}`);
}

async function login(origin, password) {
  const response = await fetch(origin + '/api/session', {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ password }),
  });
  if (response.status !== 200) throw new Error(`Login failed (${response.status}): ${await response.text()}`);
  return response.headers.get('set-cookie').split(';', 1)[0];
}
async function streamText(url, expected) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const reader = response.body.getReader(); let output = '';
  try {
    while (!output.includes(expected)) {
      const { value, done } = await reader.read(); if (done) break;
      output += new TextDecoder().decode(value);
    }
    assert.ok(output.includes(expected), output);
  } finally { await reader.cancel(); }
  return output;
}

const sqliteDirectory = mkdtempSync(join(tmpdir(), 'stock11-runtime-'));
const sqlitePath = join(sqliteDirectory, 'profile.sqlite');
const oraclePassword = 'oracle-test-password';
try {
  const vercel = await start('.next/standalone/server.js', { VERCEL: '1', STOCK11_DATA_PROVIDER: 'kis' });
  assert.equal((await fetch(vercel.origin + '/')).status, 200);
  assert.equal((await fetch(vercel.origin + '/favicon.svg')).status, 200);
  const css = readdirSync('.next/static/css').find((name) => name.endsWith('.css'));
  assert.ok(css); assert.equal((await fetch(`${vercel.origin}/_next/static/css/${css}`)).status, 200);
  assert.deepEqual(await (await fetch(vercel.origin + '/api/runtime')).json(), { provider: 'naver', refreshMs: 30000 });
  assert.equal((await fetch(vercel.origin + '/api/live?market=KOSPI&codes=005930')).status, 404);
  assert.equal((await fetch(vercel.origin + '/api/market?market=INVALID')).status, 400);
  assert.equal((await fetch(vercel.origin + '/api/chart?market=KOSPI&codes=../../secret')).status, 400);
  const redisHealth = await fetch(vercel.origin + '/api/health/redis');
  assert.equal(redisHealth.status, 503);
  assert.deepEqual(await redisHealth.json(), { ok: false, redis: 'unavailable' });
  const session = await (await fetch(vercel.origin + '/api/session')).json();
  assert.equal(session.enabled, false);
  assert.equal(session.authenticated, false);
  assert.equal((await fetch(vercel.origin + '/api/profile')).status, 503);
  await stop(vercel.child);
  console.info('PASS Vercel mode: page, static assets, runtime settings, KIS disabled, input validation.');

  const relay = await start('server/kis-relay.mjs');
  const health = await (await fetch(relay.origin + '/health')).json();
  assert.equal(health.configured, false);
  await streamText(relay.origin + '/stream?market=KOSPI&codes=005930', 'unconfigured');
  assert.equal((await fetch(relay.origin + '/stream?market=KOSPI&codes=../../secret')).status, 400);
  await stop(relay.child);
  console.info('PASS real relay without keys: honest unconfigured status, no KIS authentication attempted.');

  let activeStreams = 0;
  const mock = createServer((request, response) => {
    assert.equal(new URL(request.url, 'http://test').pathname, '/stream');
    response.writeHead(200, { 'content-type': 'text/event-stream' }); activeStreams++;
    response.on('close', () => activeStreams--);
    response.write('event: status\ndata: {"state":"connected","subscribed":1,"requested":1}\n\n');
    response.write('event: quote\ndata: {"code":"005930","price":12345,"testOnly":true}\n\n');
  });
  const relayOrigin = await listen(mock);
  const oracle = await start('.next/standalone/server.js', {
    STOCK11_DATA_PROVIDER: 'kis', KIS_RELAY_URL: relayOrigin, STOCK11_PROFILE_STORE: 'sqlite',
    STOCK11_SQLITE_PATH: sqlitePath, STOCK11_SYNC_PASSWORD: oraclePassword, STOCK11_SYNC_ORIGIN: '__TEST_ORIGIN__',
  });
  assert.equal((await (await fetch(oracle.origin + '/api/runtime')).json()).provider, 'kis');
  const oracleSession = await (await fetch(oracle.origin + '/api/session')).json();
  assert.equal(oracleSession.enabled, true); assert.equal(oracleSession.authenticated, false); assert.equal(oracleSession.location, 'Oracle 서버');
  const cookie = await login(oracle.origin, oraclePassword);
  const update = await fetch(oracle.origin + '/api/profile', {
    method: 'PATCH', headers: { origin: oracle.origin, cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ id: randomUUID(), operation: { type: 'add', item: { market: 'KOSPI', code: '005930', chartCode: '005930', name: '삼성전자' } } }),
  });
  assert.equal(update.status, 200);
  const text = await streamText(oracle.origin + '/api/live?market=KOSPI&codes=005930', 'testOnly');
  assert.match(text, /12345/);
  for (let attempt = 0; activeStreams && attempt < 30; attempt++) await delay(100);
  assert.equal(activeStreams, 0, 'SSE cancellation must release upstream subscriptions');
  mock.closeAllConnections(); await new Promise((resolve) => mock.close(resolve)); servers.delete(mock);
  assert.equal((await fetch(oracle.origin + '/api/live?market=KOSPI&codes=005930')).status, 503);
  await stop(oracle.child);
  const restartedOracle = await start('.next/standalone/server.js', {
    STOCK11_PROFILE_STORE: 'sqlite', STOCK11_SQLITE_PATH: sqlitePath, STOCK11_SYNC_PASSWORD: oraclePassword,
    STOCK11_SYNC_ORIGIN: '__TEST_ORIGIN__',
  });
  const restartedCookie = await login(restartedOracle.origin, oraclePassword);
  const persisted = await (await fetch(restartedOracle.origin + '/api/profile', { headers: { cookie: restartedCookie } })).json();
  assert.deepEqual(persisted.profile.watchlist.map((item) => item.code), ['005930']);
  await stop(restartedOracle.child);
  console.info('PASS Oracle mode: runtime switch, SQLite login/persistence, simulated SSE forwarding and fallback.');
} finally {
  await Promise.all([...children].map(stop));
  for (const server of servers) { server.closeAllConnections(); server.close(); }
  rmSync(sqliteDirectory, { recursive: true, force: true });
}
