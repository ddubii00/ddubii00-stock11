import { createServer } from 'node:http';
import { parseTrades, subscription } from './kis-protocol.mjs';

const appKey = process.env.KIS_APP_KEY;
const appSecret = process.env.KIS_APP_SECRET;
const port = Number(process.env.KIS_RELAY_PORT || 8091);
// Bind to loopback normally; Docker opts into its unexposed private network.
const host = process.env.KIS_RELAY_HOST === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1';
const limit = Math.max(1, Math.min(40, Number(process.env.KIS_MAX_SUBSCRIPTIONS) || 40));
const clients = new Set();
const sent = new Map();
const accepted = new Set();
const rejected = new Set();
let socket, approval, approvalExpires = 0, connecting = false, retryAt = 0;
let state = appKey && appSecret ? 'connecting' : 'unconfigured';
let accessToken, accessTokenExpires = 0, tokenPending;
const regularQuotes = new Map();
const afterQuotes = new Map();
const quotePending = new Map();
const KIS_ORIGIN = 'https://openapi.koreainvestment.com:9443';
const QUOTE_TTL = 25_000;

function domestic(market) { return market === 'KOSPI' || market === 'KOSDAQ'; }
function quoteKey(market, code) { return `${market}:${code}`; }
function number(value) { return Number(String(value ?? '').replaceAll(',', '')); }
function signed(value, sign) {
  const parsed = number(value);
  if (!Number.isFinite(parsed)) return parsed;
  return ['4', '5'].includes(String(sign)) ? -Math.abs(parsed) : String(sign) === '3' ? 0 : parsed;
}
function koreaAsOf(date, time) {
  return /^\d{8}$/.test(date) && /^\d{6}$/.test(time) ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}+09:00` : new Date().toISOString();
}
async function token() {
  if (accessToken && accessTokenExpires > Date.now() + 60_000) return accessToken;
  if (tokenPending) return tokenPending;
  tokenPending = (async () => {
    const response = await fetch(`${KIS_ORIGIN}/oauth2/tokenP`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ grant_type: 'client_credentials', appkey: appKey, appsecret: appSecret }),
    });
    const body = await response.json();
    if (!response.ok || typeof body.access_token !== 'string') throw new Error('KIS token unavailable');
    accessToken = body.access_token;
    // KIS tokens are long lived; rotate early without parsing or logging it.
    accessTokenExpires = Date.now() + 23 * 60 * 60 * 1000;
    return accessToken;
  })();
  try { return await tokenPending; } finally { tokenPending = undefined; }
}
async function domesticRestQuote(market, code, session) {
  const key = quoteKey(market, code);
  const cache = session === 'after' ? afterQuotes : regularQuotes;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return { ...hit.value, priceSource: 'kis-cache' };
  const pendingKey = `${session}:${key}`;
  if (quotePending.has(pendingKey)) return quotePending.get(pendingKey);
  const task = (async () => {
    // Official KIS inquire-price: J=KRX, UN=KRX/NXT integrated.  The relay
    // owns the bearer token and exposes only numeric quote fields to the app.
    const url = new URL('/uapi/domestic-stock/v1/quotations/inquire-price', KIS_ORIGIN);
    url.searchParams.set('FID_COND_MRKT_DIV_CODE', session === 'after' ? 'UN' : 'J');
    url.searchParams.set('FID_INPUT_ISCD', code);
    const response = await fetch(url, { headers: {
      authorization: `Bearer ${await token()}`, appkey: appKey, appsecret: appSecret, tr_id: 'FHKST01010100',
    }, cache: 'no-store', signal: AbortSignal.timeout(8000) });
    const body = await response.json();
    const output = body?.output;
    const price = number(output?.stck_prpr), changePrice = signed(output?.prdy_vrss, output?.prdy_vrss_sign), change = signed(output?.prdy_ctrt, output?.prdy_vrss_sign), previousClose = number(output?.stck_prdy_clpr);
    if (!response.ok || body?.rt_cd !== '0' || ![price, changePrice, change, previousClose].every(Number.isFinite) || price <= 0) throw new Error('KIS quote unavailable');
    const value = { chartCode: code, price, change, changePrice, previousClose, volume: Number.isFinite(number(output?.acml_vol)) ? String(number(output.acml_vol)) : undefined,
      asOf: koreaAsOf(String(output?.stck_bsop_date ?? ''), String(output?.stck_cntg_hour ?? '')), marketStatus: session === 'after' ? 'AFTER' : 'CLOSE', priceSource: 'kis-rest', priceSession: session };
    cache.set(key, { expires: Date.now() + QUOTE_TTL, value });
    return value;
  })();
  quotePending.set(pendingKey, task);
  try { return await task; } finally { quotePending.delete(pendingKey); }
}

function event(client, name, data) {
  if (client.response.destroyed) return;
  // Drop slow connections instead of accumulating an unbounded quote backlog.
  if (client.response.writableLength > 256_000) { client.response.destroy(); return; }
  client.response.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
}
function status() {
  for (const client of clients) {
    const subscribed = client.subscriptions.filter((item) => accepted.has(item.id)).length;
    const value = { state, subscribed, requested: client.requested, limit };
    const signature = JSON.stringify(value);
    if (signature !== client.lastStatus) { event(client, 'status', value); client.lastStatus = signature; }
  }
}
function desired() {
  const result = new Map();
  for (const client of clients) for (const item of client.subscriptions) {
    if (result.size < limit || result.has(item.id)) result.set(item.id, item);
  }
  return result;
}
async function connect() {
  if (!appKey || !appSecret || connecting || !clients.size || Date.now() < retryAt || (socket && socket.readyState < 2)) return;
  connecting = true;
  state = 'connecting'; status();
  try {
    if (!approval || approvalExpires < Date.now()) {
      const response = await fetch('https://openapi.koreainvestment.com:9443/oauth2/Approval', {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({ grant_type: 'client_credentials', appkey: appKey, secretkey: appSecret }),
      });
      const body = await response.json();
      if (!response.ok || typeof body.approval_key !== 'string') throw new Error('Approval failed');
      approval = body.approval_key;
      approvalExpires = Date.now() + 23 * 60 * 60 * 1000;
    }
    socket = new WebSocket('ws://ops.koreainvestment.com:21000');
    const current = socket;
    const handshakeTimeout = setTimeout(() => { if (current.readyState === WebSocket.CONNECTING) current.close(); }, 15_000);
    socket.addEventListener('open', () => { clearTimeout(handshakeTimeout); sent.clear(); accepted.clear(); rejected.clear(); state = 'connected'; status(); });
    socket.addEventListener('message', ({ data }) => {
      if (typeof data !== 'string') return;
      if (data.startsWith('{')) {
        try {
          const value = JSON.parse(data);
          if (value.header?.tr_id === 'PINGPONG') { current.send(data); return; }
          const id = `${value.header?.tr_id}:${value.header?.tr_key}`;
          if (value.body?.rt_cd === '0' && sent.has(id)) accepted.add(id);
          else if (value.body?.rt_cd === '1') {
            accepted.delete(id); rejected.add(id);
            if (String(value.body?.msg1).toLowerCase().includes('approval')) approvalExpires = 0;
          }
          status();
        } catch { /* Ignore malformed acknowledgements; never log credentials. */ }
        return;
      }
      for (const tick of parseTrades(data)) {
        const item = sent.get(tick.subscriptionId);
        if (!item) continue;
        accepted.add(item.id);
        for (const client of clients) if (client.ids.has(item.id)) {
          const cache = tick.session === 'after' ? afterQuotes : regularQuotes;
          cache.set(quoteKey(client.market, item.code), { expires: Date.now() + QUOTE_TTL, value: { ...tick, chartCode: item.code, marketStatus: tick.session === 'after' ? 'AFTER' : 'OPEN', priceSource: 'kis-live', priceSession: tick.session } });
          event(client, 'quote', { ...tick, code: item.code, market: client.market });
        }
      }
    });
    socket.addEventListener('error', () => { state = 'reconnecting'; status(); current.close(); });
    socket.addEventListener('close', () => {
      clearTimeout(handshakeTimeout); sent.clear(); accepted.clear(); rejected.clear();
      state = 'reconnecting'; retryAt = Date.now() + 30_000; status();
    });
  } catch { state = 'error'; retryAt = Date.now() + 60_000; status(); }
  finally { connecting = false; }
}

// One shared upstream and at most two subscription changes per second.
const reconcile = setInterval(() => {
  void connect();
  if (socket?.readyState !== WebSocket.OPEN) return;
  const wanted = desired();
  const removed = [...sent.values()].find((item) => !wanted.has(item.id));
  const added = [...wanted.values()].find((item) => !sent.has(item.id) && !rejected.has(item.id));
  const item = removed || added;
  if (!item) { status(); return; }
  try {
    socket.send(JSON.stringify({ header: { approval_key: approval, custtype: 'P', tr_type: removed ? '2' : '1', 'content-type': 'utf-8' }, body: { input: { tr_id: item.trId, tr_key: item.key } } }));
    if (removed) { sent.delete(item.id); accepted.delete(item.id); rejected.delete(item.id); }
    else sent.set(item.id, item);
  } catch { socket.close(); }
  status();
}, 500);

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  if (url.pathname === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ state, limit, configured: Boolean(appKey && appSecret) })); return;
  }
  const market = url.searchParams.get('market');
  const codes = [...new Set((url.searchParams.get('codes') || '').split(',').filter(Boolean))];
  const after = url.searchParams.get('after') === '1';
  if (request.method === 'GET' && url.pathname === '/quotes' && ['KOSPI', 'KOSDAQ', 'NASDAQ', 'NYSE', 'AMEX'].includes(market) && codes.length && codes.length <= 40 && codes.every((code) => /^[A-Za-z0-9.^-]{1,24}$/.test(code))) {
    const session = after && domestic(market) ? 'after' : 'regular';
    const quotes = {};
    // The relay serializes KIS REST into small bounded groups.  Foreign
    // symbols return only their real WebSocket cache; the app then uses its
    // documented Naver fallback rather than inventing an overseas REST call.
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, codes.length) }, async () => {
      while (cursor < codes.length) {
        const code = codes[cursor++], key = quoteKey(market, code);
        try {
          if (domestic(market)) quotes[code] = await domesticRestQuote(market, code, session);
          else {
            const hit = (session === 'after' ? afterQuotes : regularQuotes).get(key);
            if (hit) quotes[code] = { ...hit.value, priceSource: 'kis-cache' };
          }
        } catch { /* The app marks this row as Naver fallback. */ }
      }
    }));
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ quotes, session, source: 'kis-relay' })); return;
  }
  if (request.method !== 'GET' || url.pathname !== '/stream' || !['KOSPI', 'KOSDAQ', 'NASDAQ', 'NYSE', 'AMEX'].includes(market) || !codes.length || codes.length > 200 || codes.some((code) => !/^[A-Za-z0-9.^-]{1,24}$/.test(code))) {
    response.writeHead(400); response.end('Invalid market or symbols'); return;
  }
  if (clients.size >= 20) { response.writeHead(503); response.end('Connection limit'); return; }
  const subscriptions = codes.map((code) => subscription(market, code, after && domestic(market) ? 'after' : 'regular')).filter(Boolean);
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  response.write('retry: 5000\n\n');
  const client = { response, market, subscriptions, ids: new Set(subscriptions.map((item) => item.id)), requested: codes.length, lastStatus: '' };
  clients.add(client); status(); void connect();
  const keepalive = setInterval(() => response.write(': keepalive\n\n'), 15_000);
  response.on('close', () => { clearInterval(keepalive); clients.delete(client); });
});
server.listen(port, host, () => console.info(`Stock11 quote relay: http://${host}:${server.address().port} (${state})`));
function shutdown() { clearInterval(reconcile); for (const client of clients) client.response.end(); socket?.close(); server.close(); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
