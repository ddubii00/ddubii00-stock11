// Isolated production-server tests. Mock ticks never enter the user's preview.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readdirSync } from 'node:fs';
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
  const child = spawn(process.execPath, [script], { env: {
    ...process.env, NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: String(port),
    KIS_APP_KEY: '', KIS_APP_SECRET: '', KIS_RELAY_PORT: String(port), KIS_RELAY_HOST: '127.0.0.1',
    VERCEL: '', STOCK11_DATA_PROVIDER: 'naver', ...env,
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  let output = ''; child.stdout.on('data', (value) => { output += value; }); child.stderr.on('data', (value) => { output += value; });
  const origin = `http://127.0.0.1:${port}`;
  const health = script.includes('kis-relay') ? '/health' : '/api/health';
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Server exited: ${output}`);
    try { if ((await fetch(origin + health, { signal: AbortSignal.timeout(1000) })).ok) return { child, origin }; } catch { /* Startup only. */ }
    await delay(200);
  }
  throw new Error(`Server startup timeout: ${output}`);
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
  const oracle = await start('.next/standalone/server.js', { STOCK11_DATA_PROVIDER: 'kis', KIS_RELAY_URL: relayOrigin });
  assert.equal((await (await fetch(oracle.origin + '/api/runtime')).json()).provider, 'kis');
  const text = await streamText(oracle.origin + '/api/live?market=KOSPI&codes=005930', 'testOnly');
  assert.match(text, /12345/);
  for (let attempt = 0; activeStreams && attempt < 30; attempt++) await delay(100);
  assert.equal(activeStreams, 0, 'SSE cancellation must release upstream subscriptions');
  mock.closeAllConnections(); await new Promise((resolve) => mock.close(resolve)); servers.delete(mock);
  assert.equal((await fetch(oracle.origin + '/api/live?market=KOSPI&codes=005930')).status, 503);
  await stop(oracle.child);
  console.info('PASS Oracle mode: runtime switch, simulated SSE quote forwarding, cancellation, relay-failure fallback.');
} finally {
  await Promise.all([...children].map(stop));
  for (const server of servers) { server.closeAllConnections(); server.close(); }
}
