import { createServer } from 'node:http';
import { multiBatches, multiCacheKey } from './kis-multi.mjs';
import { createMarketCalendar } from './kis-market-calendar.mjs';
import { dailyRows } from './kis-daily-close.mjs';
import { parseRegularHistoricalClose } from './kis-regular-close.mjs';
import { parseNxtFinalClose, parseNxtPremarketClose, parseNxtPremarketMinutes } from './kis-nxt-close.mjs';
import { domesticQuotePlan } from './kis-domestic-routing.mjs';

const appKey = process.env.KIS_APP_KEY;
const appSecret = process.env.KIS_APP_SECRET;
const port = Number(process.env.KIS_RELAY_PORT || 8091);
const host = process.env.KIS_RELAY_HOST === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1';

let state = appKey && appSecret ? 'rest-only' : 'unconfigured';
let accessToken;
let accessTokenExpires = 0;
let tokenPending;

const KIS_ORIGIN = process.env.KIS_ORIGIN || 'https://openapi.koreainvestment.com:9443';
const restMinInterval = Math.max(100, Number(process.env.KIS_REST_MIN_INTERVAL_MS) || 350);
const restMaxConcurrency = Math.max(1, Math.min(8, Number(process.env.KIS_REST_MAX_CONCURRENCY) || 2));
const visibleRefreshMs = 3_000;
const watchRefreshMs = 3_000;
const backgroundRefreshMs = Math.max(10_000, Number(process.env.KIS_BACKGROUND_REFRESH_MS) || 20_000);
const REGULAR_CLOSE_RETRY_MS = 30_000;
const NXT_CLOSE_RETRY_MS = 30_000;

const restQueue = [];
let restActive = 0;
let restLastStarted = 0;
let restTimer;

const multiQuoteCache = new Map();
const multiQuotePending = new Map();
const overseasQuoteCache = new Map();
const overseasQuotePending = new Map();
const regularHistoricalCloseCache = new Map();
const regularHistoricalClosePending = new Map();
const nxtFinalCloseCache = new Map();
const nxtFinalClosePending = new Map();
const nxtPremarketCloseCache = new Map();
const nxtPremarketClosePending = new Map();
const nxtPremarketMinutesCache = new Map();
const nxtPremarketMinutesPending = new Map();
const latestTradeDateCache = new Map();

const diagnostics = {
  restRequests: 0,
  restSuccess: 0,
  restFailures: 0,
  restRateLimited: 0,
  restRetries: 0,
  multiRestRequests: 0,
  multiRestSuccess: 0,
  multiRestFailures: 0,
  overseasRestRequests: 0,
  overseasRestSuccess: 0,
  overseasRestFailures: 0,
  lastSuccessAt: '',
  lastError: new Map(),
};

function configured() {
  return Boolean(appKey && appSecret);
}

function domestic(market) {
  return market === 'KOSPI' || market === 'KOSDAQ';
}

function validCode(code) {
  return /^[A-Za-z0-9.^-]{1,24}$/.test(String(code || ''));
}

function number(value) {
  const text = String(value ?? '').replaceAll(',', '').trim();
  return text ? Number(text) : Number.NaN;
}

function signed(value, sign) {
  const parsed = number(value);
  if (!Number.isFinite(parsed)) return parsed;
  const code = String(sign ?? '').trim();
  if (code === '4' || code === '5') return -Math.abs(parsed);
  if (code === '1' || code === '2') return Math.abs(parsed);
  if (code === '3') return 0;
  return parsed;
}

function multiTtl(scope) {
  return scope === 'watch' ? watchRefreshMs : scope === 'background' ? backgroundRefreshMs : visibleRefreshMs;
}
function seoulParts() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date()).reduce((out, part) => ({ ...out, [part.type]: part.value }), {});
}

function seoulClock() {
  const part = seoulParts();
  return {
    date: `${part.year}${part.month}${part.day}`,
    minute: Number(part.hour) * 60 + Number(part.minute),
  };
}

function reportRestError({ market, code, session, status, body, timeout }) {
  diagnostics.restFailures++;
  if (status === 429 || body?.msg_cd === 'EGW00201') diagnostics.restRateLimited++;
  const message = JSON.stringify({
    market,
    code,
    session,
    status,
    rt_cd: body?.rt_cd,
    msg_cd: body?.msg_cd,
    msg1: body?.msg1,
    timeout: Boolean(timeout),
  });
  const key = `${market}:${code}:${session}:${status ?? 'network'}:${body?.msg_cd ?? ''}`;
  if (diagnostics.lastError.get(key) !== message) {
    diagnostics.lastError.set(key, message);
    console.warn(`KIS REST failure ${message}`);
  }
}

function drainRestQueue() {
  clearTimeout(restTimer);
  if (!restQueue.length || restActive >= restMaxConcurrency) return;
  const delay = Math.max(0, restMinInterval - (Date.now() - restLastStarted));
  if (delay) {
    restTimer = setTimeout(drainRestQueue, delay);
    return;
  }
  const job = restQueue.shift();
  restActive++;
  restLastStarted = Date.now();
  diagnostics.restRequests++;
  void job().finally(() => {
    restActive--;
    drainRestQueue();
  });
  if (restActive < restMaxConcurrency) drainRestQueue();
}

function queueRest(job) {
  return new Promise((resolve, reject) => {
    restQueue.push(async () => {
      try {
        resolve(await job());
      } catch (error) {
        reject(error);
      }
    });
    drainRestQueue();
  });
}

async function token() {
  if (!configured()) throw new Error('KIS REST unconfigured');
  if (accessToken && accessTokenExpires > Date.now() + 60_000) return accessToken;
  if (tokenPending) return tokenPending;

  tokenPending = (async () => {
    const response = await fetch(`${KIS_ORIGIN}/oauth2/tokenP`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        grant_type: 'client_credentials',
        appkey: appKey,
        appsecret: appSecret,
      }),
    });
    const body = await response.json();
    if (!response.ok || typeof body.access_token !== 'string') throw new Error('KIS token unavailable');
    accessToken = body.access_token;
    accessTokenExpires = Date.now() + 23 * 60 * 60 * 1000;
    return accessToken;
  })();

  try {
    return await tokenPending;
  } finally {
    tokenPending = undefined;
  }
}

async function kisGet(path, trId, params, market, code, session) {
  return queueRest(async () => {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      const url = new URL(path, KIS_ORIGIN);
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));

      let response;
      let body;
      try {
        response = await fetch(url, {
          headers: {
            authorization: `Bearer ${await token()}`,
            appkey: appKey,
            appsecret: appSecret,
            tr_id: trId,
            custtype: 'P',
          },
          cache: 'no-store',
          signal: AbortSignal.timeout(8_000),
        });
        body = await response.json();
      } catch (error) {
        lastError = error;
        reportRestError({ market, code, session, timeout: error?.name === 'TimeoutError' });
      }

      if (response?.ok && body?.rt_cd === '0') {
        diagnostics.restSuccess++;
        diagnostics.lastSuccessAt = new Date().toISOString();
        return body;
      }

      const retry = !response
        || response.status === 429
        || response.status >= 500
        || ['EGW00123', 'EGW00201'].includes(body?.msg_cd);

      reportRestError({
        market,
        code,
        session,
        status: response?.status,
        body,
        timeout: !response,
      });

      if (!retry || attempt === 2) {
        throw new Error(`KIS REST ${body?.msg_cd ?? response?.status ?? 'network'}`);
      }

      diagnostics.restRetries++;
      await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** attempt)));
    }

    throw lastError ?? new Error('KIS REST unavailable');
  });
}

const marketCalendar = createMarketCalendar({
  clock: seoulClock,
  fetchHoliday: (date) => kisGet(
    '/uapi/domestic-stock/v1/quotations/chk-holiday',
    'CTCA0903R',
    { BASS_DT: date, CTX_AREA_FK: '', CTX_AREA_NK: '' },
    'KOSPI',
    `calendar:${date}`,
    'calendar',
  ),
});

function multiRows(body) {
  if (Array.isArray(body?.output)) return body.output;
  if (Array.isArray(body?.output?.items)) return body.output.items;
  if (body?.output && typeof body.output === 'object' && typeof body.output.inter_shrn_iscd === 'string') return [body.output];
  return [];
}

function multiQuote(row, session) {
  const price = number(row?.inter2_prpr);
  const changePrice = signed(row?.inter2_prdy_vrss, row?.prdy_vrss_sign);
  const change = signed(row?.prdy_ctrt, row?.prdy_vrss_sign);
  const directPreviousClose = number(row?.inter2_prdy_clpr);
  const previousClose = directPreviousClose > 0 ? directPreviousClose : price - changePrice;

  if (![price, changePrice, change, previousClose].every(Number.isFinite) || price <= 0 || previousClose <= 0) {
    return undefined;
  }

  const { minute } = seoulClock();
  const fetchedAt = new Date().toISOString();
  return {
    chartCode: String(row.inter_shrn_iscd),
    ...(typeof row.inter_kor_isnm === 'string' && row.inter_kor_isnm ? { name: row.inter_kor_isnm } : {}),
    price,
    previousClose,
    change,
    changePrice,
    ...(Number.isFinite(number(row?.acml_vol)) ? { volume: String(number(row.acml_vol)) } : {}),
    asOf: fetchedAt,
    fetchedAt,
    marketStatus: session === 'pre' ? 'PRE' : session === 'after' ? 'AFTER' : minute >= 930 ? 'CLOSE' : 'OPEN',
    priceSource: 'kis-multi-rest',
    priceSession: session === 'pre' ? 'after' : session,
  };
}

async function currentDomesticQuotes(market, codes, session, scope) {
  const marketCode = session === 'after' || session === 'pre' ? 'NX' : 'J';
  const batches = multiBatches(codes, marketCode);
  const canonical = batches.flatMap((batch) => batch.codes);
  const cacheKey = multiCacheKey(market, session, codes);
  const ttl = multiTtl(scope);
  const cached = multiQuoteCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < ttl) {
    return { quotes: cached.quotes, refreshMs: ttl };
  }
  if (multiQuotePending.has(cacheKey)) return multiQuotePending.get(cacheKey);

  const task = (async () => {
    const quotes = {};
    try {
      for (const batch of batches) {
        diagnostics.multiRestRequests++;
        const body = await kisGet(
          '/uapi/domestic-stock/v1/quotations/intstock-multprice',
          'FHKST11300006',
          batch.params,
          market,
          batch.codes.join(','),
          session,
        );
        const rows = multiRows(body);
        if (!rows.length) throw new Error('KIS multi quote response unavailable');
        for (const row of rows) {
          const quote = multiQuote(row, session);
          if (quote && canonical.includes(quote.chartCode)) quotes[quote.chartCode] = quote;
        }
      }
      diagnostics.multiRestSuccess++;
      multiQuoteCache.set(cacheKey, { quotes, fetchedAt: Date.now() });
      return { quotes, refreshMs: ttl };
    } catch (error) {
      diagnostics.multiRestFailures++;
      throw error;
    }
  })();

  multiQuotePending.set(cacheKey, task);
  try {
    return await task;
  } finally {
    multiQuotePending.delete(cacheKey);
  }
}

async function resolveLatestTradingDate(market, sampleCode, open, clock) {
  // The key fix: after 15:30 on an actual KRX trading day, never let a
  // lagging daily-price response push the quote back to yesterday.
  if (open && clock.minute >= 930) return clock.date;

  const cacheKey = `${market}:${clock.date}`;
  const cached = latestTradeDateCache.get(cacheKey);
  if (cached) return cached;

  const body = await kisGet(
    '/uapi/domestic-stock/v1/quotations/inquire-daily-price',
    'FHKST01010400',
    {
      FID_COND_MRKT_DIV_CODE: 'J',
      FID_INPUT_ISCD: sampleCode,
      FID_PERIOD_DIV_CODE: 'D',
      FID_ORG_ADJ_PRC: '0',
    },
    market,
    sampleCode,
    'trade-date',
  );

  const tradeDate = dailyRows(body)
    .map((row) => String(row?.stck_bsop_date ?? ''))
    .filter((date) => /^\d{8}$/.test(date))
    .sort((left, right) => right.localeCompare(left))[0];

  if (!tradeDate) return undefined;
  latestTradeDateCache.set(cacheKey, tradeDate);
  return tradeDate;
}

async function readRegularHistoricalClose(market, code, tradeDate) {
  const key = `${market}:${code}:${tradeDate}`;
  const cached = regularHistoricalCloseCache.get(key);
  if (cached?.quote) return cached.quote;
  if (cached?.retryAt && cached.retryAt > Date.now()) return undefined;
  if (regularHistoricalClosePending.has(key)) return regularHistoricalClosePending.get(key);

  const task = (async () => {
    try {
      const body = await kisGet(
        '/uapi/domestic-stock/v1/quotations/inquire-time-dailychartprice',
        'FHKST03010230',
        {
          FID_COND_MRKT_DIV_CODE: 'J',
          FID_INPUT_ISCD: code,
          FID_INPUT_HOUR_1: '153000',
          FID_INPUT_DATE_1: tradeDate,
          FID_PW_DATA_INCU_YN: 'N',
          FID_FAKE_TICK_INCU_YN: '',
        },
        market,
        code,
        'regular-history',
      );

      const parsed = parseRegularHistoricalClose(body, code, tradeDate);
      if (!parsed?.quote) {
        regularHistoricalCloseCache.set(key, { retryAt: Date.now() + REGULAR_CLOSE_RETRY_MS });
        return undefined;
      }

      regularHistoricalCloseCache.set(key, { quote: parsed.quote });
      return parsed.quote;
    } catch {
      regularHistoricalCloseCache.set(key, { retryAt: Date.now() + REGULAR_CLOSE_RETRY_MS });
      return undefined;
    }
  })();

  regularHistoricalClosePending.set(key, task);
  try {
    return await task;
  } finally {
    regularHistoricalClosePending.delete(key);
  }
}

async function regularHistoricalQuotes(market, codes, scope, open, clock) {
  if (!codes.length) return { quotes: {}, refreshMs: multiTtl(scope) };

  const tradeDate = await resolveLatestTradingDate(market, codes[0], open, clock);
  if (!tradeDate) return { quotes: {}, refreshMs: multiTtl(scope) };

  const quotes = {};
  const values = await Promise.allSettled(codes.map(async (code) => ({
    code,
    quote: await readRegularHistoricalClose(market, code, tradeDate),
  })));

  for (const value of values) {
    if (value.status === 'fulfilled' && value.value.quote) quotes[value.value.code] = value.value.quote;
  }

  return { quotes, refreshMs: multiTtl(scope) };
}

async function readNxtFinalClose(market, code, tradeDate) {
  const key = `${market}:${code}:${tradeDate}`;
  const cached = nxtFinalCloseCache.get(key);
  if (cached?.quote) return cached.quote;
  if (cached?.retryAt && cached.retryAt > Date.now()) return undefined;
  if (nxtFinalClosePending.has(key)) return nxtFinalClosePending.get(key);

  const task = (async () => {
    try {
      const regular = await readRegularHistoricalClose(market, code, tradeDate);
      const body = await kisGet(
        '/uapi/domestic-stock/v1/quotations/inquire-time-dailychartprice',
        'FHKST03010230',
        {
          FID_COND_MRKT_DIV_CODE: 'NX',
          FID_INPUT_ISCD: code,
          FID_INPUT_HOUR_1: '200000',
          FID_INPUT_DATE_1: tradeDate,
          FID_PW_DATA_INCU_YN: 'N',
          FID_FAKE_TICK_INCU_YN: '',
        },
        market,
        code,
        'nxt-close',
      );

      const parsed = parseNxtFinalClose(body, code, tradeDate, regular?.previousClose);
      if (!parsed?.quote) {
        nxtFinalCloseCache.set(key, { retryAt: Date.now() + NXT_CLOSE_RETRY_MS });
        return undefined;
      }

      nxtFinalCloseCache.set(key, { quote: parsed.quote });
      return parsed.quote;
    } catch {
      nxtFinalCloseCache.set(key, { retryAt: Date.now() + NXT_CLOSE_RETRY_MS });
      return undefined;
    }
  })();

  nxtFinalClosePending.set(key, task);
  try {
    return await task;
  } finally {
    nxtFinalClosePending.delete(key);
  }
}

async function readNxtPremarketClose(market, code, tradeDate) {
  const key = `${market}:${code}:${tradeDate}`;
  const cached = nxtPremarketCloseCache.get(key);
  if (cached?.quote) return cached.quote;
  if (cached?.retryAt && cached.retryAt > Date.now()) return undefined;
  if (nxtPremarketClosePending.has(key)) return nxtPremarketClosePending.get(key);

  const task = (async () => {
    try {
      const regular = await readRegularHistoricalClose(market, code, tradeDate);
      const body = await kisGet(
        '/uapi/domestic-stock/v1/quotations/inquire-time-dailychartprice',
        'FHKST03010230',
        {
          FID_COND_MRKT_DIV_CODE: 'NX',
          FID_INPUT_ISCD: code,
          FID_INPUT_HOUR_1: '085000',
          FID_INPUT_DATE_1: tradeDate,
          FID_PW_DATA_INCU_YN: 'N',
          FID_FAKE_TICK_INCU_YN: '',
        },
        market,
        code,
        'nxt-pre-close',
      );
      const parsed = parseNxtPremarketClose(body, code, tradeDate, regular?.previousClose);
      if (!parsed?.quote) {
        nxtPremarketCloseCache.set(key, { retryAt: Date.now() + NXT_CLOSE_RETRY_MS });
        return undefined;
      }
      nxtPremarketMinutesCache.set(key, {
        data: { points: parseNxtPremarketMinutes(body, tradeDate), previousClose: parsed.quote.previousClose },
        complete: true,
        fetchedAt: Date.now(),
      });
      nxtPremarketCloseCache.set(key, { quote: parsed.quote });
      return parsed.quote;
    } catch {
      nxtPremarketCloseCache.set(key, { retryAt: Date.now() + NXT_CLOSE_RETRY_MS });
      return undefined;
    }
  })();
  nxtPremarketClosePending.set(key, task);
  try {
    return await task;
  } finally {
    nxtPremarketClosePending.delete(key);
  }
}

async function readNxtPremarketMinutes(market, code, tradeDate) {
  const key = `${market}:${code}:${tradeDate}`;
  const cached = nxtPremarketMinutesCache.get(key);
  const clock = seoulClock();
  const complete = tradeDate < clock.date || clock.minute >= 530;
  if (cached && (cached.complete || Date.now() - cached.fetchedAt < NXT_CLOSE_RETRY_MS)) return cached.data;
  if (nxtPremarketMinutesPending.has(key)) return nxtPremarketMinutesPending.get(key);
  const task = (async () => {
    try {
      const body = await kisGet('/uapi/domestic-stock/v1/quotations/inquire-time-dailychartprice', 'FHKST03010230', {
        FID_COND_MRKT_DIV_CODE: 'NX', FID_INPUT_ISCD: code, FID_INPUT_HOUR_1: '085000', FID_INPUT_DATE_1: tradeDate,
        FID_PW_DATA_INCU_YN: 'N', FID_FAKE_TICK_INCU_YN: '',
      }, market, code, 'nxt-pre-minutes');
      const points = parseNxtPremarketMinutes(body, tradeDate);
      const summary = Array.isArray(body?.output1) ? body.output1[0] : body?.output1;
      const previousClose = number(summary?.stck_prdy_clpr);
      const data = { points, ...(Number.isFinite(previousClose) && previousClose > 0 ? { previousClose } : {}) };
      nxtPremarketMinutesCache.set(key, { data, complete: complete && (points.length > 0 || tradeDate < clock.date || clock.minute >= 540), fetchedAt: Date.now() });
      return data;
    } catch {
      const data = cached?.data ?? { points: [] };
      nxtPremarketMinutesCache.set(key, { data, complete: false, fetchedAt: Date.now() });
      return data;
    }
  })();
  nxtPremarketMinutesPending.set(key, task);
  try {
    return await task;
  } finally {
    nxtPremarketMinutesPending.delete(key);
  }
}

async function nxtPremarketCloseQuotes(market, codes, scope, clock) {
  if (!codes.length) return { quotes: {}, refreshMs: multiTtl(scope) };
  const quotes = {};
  const values = await Promise.allSettled(codes.map(async (code) => ({
    code,
    quote: await readNxtPremarketClose(market, code, clock.date),
  })));
  for (const value of values) {
    if (value.status === 'fulfilled' && value.value.quote) quotes[value.value.code] = value.value.quote;
  }
  return { quotes, refreshMs: multiTtl(scope) };
}

async function nxtFinalQuotes(market, codes, scope, open, clock) {
  if (!codes.length) return { quotes: {}, refreshMs: multiTtl(scope) };

  const tradeDate = await resolveLatestTradingDate(market, codes[0], open, clock);
  if (!tradeDate) return { quotes: {}, refreshMs: multiTtl(scope) };

  const quotes = {};
  const values = await Promise.allSettled(codes.map(async (code) => ({
    code,
    quote: await readNxtFinalClose(market, code, tradeDate),
  })));

  for (const value of values) {
    if (value.status === 'fulfilled' && value.value.quote) quotes[value.value.code] = value.value.quote;
  }

  return { quotes, refreshMs: multiTtl(scope) };
}

async function domesticQuotes(market, codes, requestedAfter, scope) {
  const session = await marketCalendar.sessionFor(requestedAfter);
  const clock = seoulClock();
  const open = await marketCalendar.isOpenTradingDay(clock.date);
  const plan = domesticQuotePlan({ session, open, minute: clock.minute });

  if (plan.source === 'multi') return currentDomesticQuotes(market, codes, session, scope);
  if (plan.source === 'nxt-pre-close') return nxtPremarketCloseQuotes(market, codes, scope, clock);
  if (plan.source === 'nxt-close') return nxtFinalQuotes(market, codes, scope, open, clock);
  return regularHistoricalQuotes(market, codes, scope, open, clock);
}

function overseasExchange(market) {
  if (market === 'NASDAQ') return 'NAS';
  if (market === 'NYSE') return 'NYS';
  if (market === 'AMEX') return 'AMS';
  return undefined;
}

function overseasSymbol(code) {
  return String(code || '').toUpperCase().replace(/\.(O|N|K)$/i, '');
}

async function readOverseasQuote(market, code, scope) {
  const exchange = overseasExchange(market);
  if (!exchange) return undefined;

  const symbol = overseasSymbol(code);
  const key = `${market}:${symbol}`;
  const ttl = multiTtl(scope);
  const cached = overseasQuoteCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < ttl) return cached.quote;
  if (overseasQuotePending.has(key)) return overseasQuotePending.get(key);

  const task = (async () => {
    try {
      diagnostics.overseasRestRequests++;
      const body = await kisGet(
        '/uapi/overseas-price/v1/quotations/price',
        'HHDFS00000300',
        { AUTH: '', EXCD: exchange, SYMB: symbol },
        market,
        code,
        'regular',
      );
      const out = body?.output ?? {};
      const price = number(out.last);
      const changePrice = signed(out.diff, out.sign);
      const change = signed(out.rate, out.sign);
      const base = number(out.base);
      const previousClose = base > 0 ? base : price - changePrice;

      if (![price, changePrice, change, previousClose].every(Number.isFinite) || price <= 0 || previousClose <= 0) {
        throw new Error('KIS overseas price response unavailable');
      }

      const fetchedAt = new Date().toISOString();
      const volume = number(out.tvol);
      const quote = {
        chartCode: code,
        price,
        previousClose,
        change,
        changePrice,
        ...(Number.isFinite(volume) && volume >= 0 ? { volume: String(volume) } : {}),
        asOf: fetchedAt,
        fetchedAt,
        priceSource: 'kis-rest',
        priceSession: 'regular',
      };

      diagnostics.overseasRestSuccess++;
      overseasQuoteCache.set(key, { quote, fetchedAt: Date.now() });
      return quote;
    } catch (error) {
      diagnostics.overseasRestFailures++;
      throw error;
    }
  })();

  overseasQuotePending.set(key, task);
  try {
    return await task;
  } finally {
    overseasQuotePending.delete(key);
  }
}

async function overseasQuotes(market, codes, scope) {
  const quotes = {};
  const values = await Promise.allSettled(codes.map(async (code) => ({
    code,
    quote: await readOverseasQuote(market, code, scope),
  })));

  for (const value of values) {
    if (value.status === 'fulfilled' && value.value.quote) quotes[value.value.code] = value.value.quote;
  }

  return { quotes, refreshMs: multiTtl(scope) };
}

function json(response, status, value) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(value));
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1');

  if (url.pathname === '/health') {
    const calendar = marketCalendar.diagnostics();
    return json(response, 200, {
      state,
      configured: configured(),
      transport: 'rest-only',
      websocket: false,
      refreshMs: 3000,
      restQueueDepth: restQueue.length,
      restRequests: diagnostics.restRequests,
      restSuccess: diagnostics.restSuccess,
      restFailures: diagnostics.restFailures,
      restRateLimited: diagnostics.restRateLimited,
      restRetries: diagnostics.restRetries,
      multiRestRequests: diagnostics.multiRestRequests,
      multiRestSuccess: diagnostics.multiRestSuccess,
      multiRestFailures: diagnostics.multiRestFailures,
      overseasRestRequests: diagnostics.overseasRestRequests,
      overseasRestSuccess: diagnostics.overseasRestSuccess,
      overseasRestFailures: diagnostics.overseasRestFailures,
      lastSuccessAt: diagnostics.lastSuccessAt || undefined,
      marketCalendarDate: calendar.date ?? seoulClock().date,
      marketCalendarOpen: calendar.open ?? null,
      recentErrors: [...diagnostics.lastError.values()].slice(-12).map((entry) => JSON.parse(entry)),
    });
  }
  if (url.pathname === '/stream') {
    return json(response, 410, {
      error: 'WebSocket streaming is disabled. Stock11 uses KIS REST polling only.',
      websocket: false,
    });
  }

  if (request.method === 'GET' && url.pathname === '/premarket-minutes') {
    const market = url.searchParams.get('market');
    const code = url.searchParams.get('code') ?? '';
    const date = url.searchParams.get('date') ?? '';
    if (!domestic(market) || !/^[A-Za-z0-9]{6}$/.test(code) || !/^\d{8}$/.test(date) || date > seoulClock().date) {
      return json(response, 400, { error: 'Invalid premarket request' });
    }
    if (!appKey || !appSecret) {
      return json(response, 200, { points: [] });
    }
    const data = await readNxtPremarketMinutes(market, code, date);
    return json(response, 200, data);
  }

  if (request.method !== 'GET' || url.pathname !== '/quotes') {
    return json(response, 404, { error: 'Not found' });
  }

  const market = url.searchParams.get('market');
  const codes = [...new Set((url.searchParams.get('codes') || '').split(',').filter(Boolean))];
  const after = url.searchParams.get('after') === '1';
  const scope = ['watch', 'visible', 'background'].includes(url.searchParams.get('scope'))
    ? url.searchParams.get('scope')
    : 'visible';

  if (!['KOSPI', 'KOSDAQ', 'NASDAQ', 'NYSE', 'AMEX'].includes(market)
    || !codes.length
    || codes.length > 200
    || codes.some((code) => !validCode(code))) {
    return json(response, 400, { error: 'Invalid market or symbols' });
  }

  if (!configured()) {
    state = 'unconfigured';
    return json(response, 503, {
      quotes: {},
      errors: Object.fromEntries(codes.map((code) => [code, 'KIS REST unconfigured'])),
      source: 'kis-rest-only',
      websocket: false,
      refreshMs: 3000,
    });
  }

  try {
    state = 'rest-only';
    const result = domestic(market)
      ? await domesticQuotes(market, codes, after, scope)
      : await overseasQuotes(market, codes, scope);

    const errors = {};
    for (const code of codes) {
      if (!result.quotes[code]) errors[code] = 'KIS REST quote unavailable';
    }

    return json(response, 200, {
      quotes: result.quotes,
      errors,
      source: 'kis-rest-only',
      websocket: false,
      refreshMs: 3000,
    });
  } catch (error) {
    state = 'error';
    return json(response, 503, {
      quotes: {},
      errors: Object.fromEntries(codes.map((code) => [
        code,
        error instanceof Error ? error.message : 'KIS REST unavailable',
      ])),
      source: 'kis-rest-only',
      websocket: false,
      refreshMs: 3000,
    });
  }
});

server.listen(port, host, () => {
  console.info(`Stock11 KIS REST relay: http://${host}:${server.address().port} (${state})`);
});

function shutdown() {
  clearTimeout(restTimer);
  server.close();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
