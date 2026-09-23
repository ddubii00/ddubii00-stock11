import type { Market, MinuteSeries, MarketPayload, IndexQuote, Quote, StockSelection, CandleSeries } from './market-types';
import { searchUsSymbols } from './us-symbol-search';
import { clockInZone } from './chart-model';

const headers = { Accept: 'application/json', Referer: 'https://m.stock.naver.com/', 'User-Agent': 'Mozilla/5.0' };
const cache = new Map<string, { expires: number; value: unknown }>();
const pending = new Map<string, Promise<unknown>>();

export async function naverJson<T>(url: string, ttl = 7000): Promise<T> {
  const hit = cache.get(url);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  if (pending.has(url)) return pending.get(url) as Promise<T>;
  const task = (async () => {
    const response = await fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`시세 제공처 응답 ${response.status}`);
    const value = await response.json() as T;
    if (cache.size > 400) {
      for (const [key, entry] of cache) if (entry.expires <= Date.now()) cache.delete(key);
    }
    cache.set(url, { expires: Date.now() + ttl, value });
    return value;
  })();
  pending.set(url, task);
  try { return await task; } finally { pending.delete(url); }
}

const number = (value: string | number | undefined | null) => {
  const text = String(value ?? '').replaceAll(',', '').trim();
  return text ? Number(text) : Number.NaN;
};
type Stock = {
  stockEndType: string; itemCode?: string; reutersCode?: string; symbolCode?: string;
  stockName: string; closePrice: string; compareToPreviousClosePrice: string; fluctuationsRatio: string;
  accumulatedTradingValueKrwHangeul?: string; accumulatedTradingValue?: string;
  accumulatedTradingVolume?: string | number; tradeVolume?: string | number; volume?: string | number;
  marketStatus: string; localTradedAt: string;
  stockExchangeType?: { name: string };
  compareToPreviousPrice?: { code?: string; name?: string; text?: string };
  overMarketPriceInfo?: {
    overPrice?: string | number; compareToPreviousClosePrice?: string | number; fluctuationsRatio?: string | number;
    accumulatedTradingVolume?: string | number; localTradedAt?: string; overMarketStatus?: string;
    compareToPreviousPrice?: { code?: string; name?: string; text?: string };
  };
};
type Basic = { closePrice: string; fluctuationsRatio: string; localTradedAt: string };

const domestic = (market: Market) => market === 'KOSPI' || market === 'KOSDAQ';
function exchange(stock: Stock, fallback: Market): StockSelection['market'] {
  const name = stock.stockExchangeType?.name;
  return name === 'KOSPI' || name === 'KOSDAQ' || name === 'NASDAQ' || name === 'NYSE' || name === 'AMEX' ? name : fallback === 'SP500' || fallback === 'DOW' ? 'NYSE' : fallback;
}
function signedNumber(value: string | number | undefined, direction?: Stock['compareToPreviousPrice']) {
  const parsed = number(value);
  if (!Number.isFinite(parsed)) return parsed;
  if (parsed < 0) return parsed;
  const marker = `${direction?.code ?? ''} ${direction?.name ?? ''} ${direction?.text ?? ''}`;
  if (/하락|FALLING|5|4/i.test(marker)) return -Math.abs(parsed);
  if (/보합|UNCHANGED|3/i.test(marker)) return 0;
  return Math.abs(parsed);
}
function isNxtPriceWindow(stock: Stock, market: Market, afterMarket: boolean, now: Date) {
  if (!afterMarket || !domestic(market)) return false;
  const { date, minute } = clockInZone(now, 'Asia/Seoul');
  const stockDate = stock.localTradedAt.replace(/\D/g, '').slice(0, 8);
  // During today's KRX session the NXT field can still carry the morning
  // premarket price. Closed days retain the last NXT final instead.
  if (stockDate === date && minute >= 540 && minute < 960) return false;
  // At today's premarket open, an unchanged over-market field may still
  // contain yesterday's last print. Wait for a same-day NX timestamp.
  if (stockDate === date && minute >= 480 && minute < 540) {
    const nxtDate = String(stock.overMarketPriceInfo?.localTradedAt ?? '').replace(/\D/g, '').slice(0, 8);
    return nxtDate === date;
  }
  return true;
}
function quoteFrom(stock: Stock, fallback: Market, afterMarket = false, now = new Date()): Quote {
  const market = exchange(stock, fallback);
  const after = isNxtPriceWindow(stock, market, afterMarket, now) && stock.overMarketPriceInfo && number(stock.overMarketPriceInfo.overPrice) > 0
    ? stock.overMarketPriceInfo : undefined;
  const afterTime = String(after?.localTradedAt ?? '').match(/T(\d{2}):(\d{2})/);
  const afterMinute = afterTime ? Number(afterTime[1]) * 60 + Number(afterTime[2]) : clockInZone(now, 'Asia/Seoul').minute;
  const price = number(after?.overPrice ?? stock.closePrice);
  const changePrice = after ? signedNumber(after.compareToPreviousClosePrice, after.compareToPreviousPrice) : number(stock.compareToPreviousClosePrice);
  const change = after ? signedNumber(after.fluctuationsRatio, after.compareToPreviousPrice) : number(stock.fluctuationsRatio);
  if (![price, changePrice, change].every(Number.isFinite) || price <= 0) throw new Error('유효한 현재가가 없습니다.');
  const volume = after?.accumulatedTradingVolume ?? stock.accumulatedTradingVolume ?? stock.tradeVolume ?? stock.volume;
  return {
    ...(stock.stockEndType === 'etf' ? { instrumentType: 'etf' as const } : {}),
    code: stock.symbolCode ?? stock.itemCode ?? stock.reutersCode ?? '', chartCode: stock.itemCode ?? stock.reutersCode ?? '',
    name: stock.stockName, market, marketStatus: after?.overMarketStatus === 'OPEN' ? (afterMinute >= 480 && afterMinute <= 530 ? 'PRE' : 'AFTER') : stock.marketStatus, price, changePrice, change, previousClose: price - changePrice,
    turnover: domestic(market) ? stock.accumulatedTradingValueKrwHangeul ?? '—' : stock.accumulatedTradingValue ?? '—',
    volume: Number.isFinite(number(volume)) ? number(volume).toLocaleString('en-US') : '—',
    asOf: after?.localTradedAt ?? stock.localTradedAt,
  };
}

// The lightweight /basic endpoint does not expose accumulated volume for
// domestic stocks. Fill only that missing field from Naver's realtime polling
// endpoint; failures remain non-fatal so price boards keep working.
async function readDomesticRealtimeVolume(code: string): Promise<string | number | undefined> {
  try {
    const payload = await naverJson<{ datas?: Pick<Stock, 'accumulatedTradingVolume'>[] }>(
      `https://polling.finance.naver.com/api/realtime/domestic/stock/${encodeURIComponent(code)}`, 5000,
    );
    return payload.datas?.[0]?.accumulatedTradingVolume;
  } catch {
    return undefined;
  }
}

// The market-value list can retain the regular quote while NXT/after-market
// data changes independently.  Read the provider's dedicated polling field in
// KRX2 mode so its price is not accidentally inherited from a list snapshot.
type DomesticPollingQuote = { cd?: string; nxtOverMarketPriceInfo?: Stock['overMarketPriceInfo'] };
async function readDomesticAfterPrices(codes: string[]): Promise<Map<string, NonNullable<Stock['overMarketPriceInfo']>>> {
  const result = new Map<string, NonNullable<Stock['overMarketPriceInfo']>>();
  for (let index = 0; index < codes.length; index += 80) {
    const query = `SERVICE_ITEM:${codes.slice(index, index + 80).join(',')}`;
    try {
      const payload = await naverJson<{ result?: { areas?: { datas?: DomesticPollingQuote[] }[] } }>(
        `https://polling.finance.naver.com/api/realtime?query=${encodeURIComponent(query)}`, 5000,
      );
      for (const item of payload.result?.areas?.flatMap((area) => area.datas ?? []) ?? []) {
        const after = item.nxtOverMarketPriceInfo;
        if (item.cd && after && number(after.overPrice) > 0) result.set(item.cd, after as NonNullable<Stock['overMarketPriceInfo']>);
      }
    } catch {
      // The market snapshot already contains a best-effort after-market field.
    }
  }
  return result;
}

// Foreign basic snapshots can return an apostrophe placeholder for volume.
// The latest daily bar carries the numeric accumulated volume instead.
async function readForeignVolume(code: string): Promise<string | number | undefined> {
  try {
    const payload = await naverJson<{ priceInfos?: { accumulatedTradingVolume?: string | number }[] }>(
      `https://api.stock.naver.com/chart/foreign/item/${encodeURIComponent(code)}?periodType=dayCandle`, 5000,
    );
    for (const bar of [...(payload.priceInfos ?? [])].reverse()) {
      if (Number.isFinite(number(bar.accumulatedTradingVolume))) return bar.accumulatedTradingVolume;
    }
  } catch {
    // Keep the quote usable when the optional volume request is unavailable.
  }
  return undefined;
}

export async function readStocks(market: Market, afterMarket = false, now = new Date()): Promise<Omit<MarketPayload, 'indices'>> {
  const url = (page: number) => market === 'SP500' || market === 'DOW'
    ? `https://api.stock.naver.com/index/${market === 'DOW' ? '.DJI' : '.INX'}/stocks?page=${page}&pageSize=100`
    : !domestic(market)
    ? `https://api.stock.naver.com/stock/exchange/${market}/marketValue?page=${page}&pageSize=100`
    : `https://m.stock.naver.com/api/stocks/marketValue/${market}?page=${page}&pageSize=100`;
  let stocks: Stock[] = [];
  for (let page = 1; stocks.length < 200 && page <= 4; page++) {
    const data = await naverJson<{ stocks: Stock[] } | Stock[]>(url(page));
    const more = Array.isArray(data) ? data : data.stocks;
    if (!more?.length) break;
    stocks = [...new Map([...stocks, ...more.filter((stock) => stock.stockEndType === 'stock')].map((stock) => [stock.itemCode ?? stock.reutersCode, stock])).values()];
    if (more.length < 100) break;
  }
  stocks = stocks.slice(0, 200);
  if (!stocks.length) throw new Error('종목 데이터를 받지 못했습니다.');
  if (afterMarket && domestic(market)) {
    const prices = await readDomesticAfterPrices(stocks.map((stock) => stock.itemCode ?? stock.reutersCode ?? '').filter(Boolean));
    stocks = stocks.map((stock) => {
      const after = prices.get(stock.itemCode ?? stock.reutersCode ?? '');
      return after ? { ...stock, overMarketPriceInfo: after } : stock;
    });
  }
  const quotes = stocks.map((stock) => quoteFrom(stock, market, afterMarket, now));
  return {
    stocks: quotes,
    marketStatus: quotes.some((quote) => quote.marketStatus === 'PRE') ? 'PRE' : quotes.some((quote) => quote.marketStatus === 'AFTER') ? 'AFTER' : stocks[0].marketStatus,
    asOf: quotes.map((quote) => quote.asOf).reduce((latest, time) => time > latest ? time : latest, stocks[0].localTradedAt),
    source: afterMarket && domestic(market) ? '네이버 증권 · 장전·장후 포함' : '네이버 증권',
  };
}

export async function readIndices(): Promise<IndexQuote[]> {
  const jobs = await Promise.allSettled([
    ...['KOSPI', 'KOSDAQ'].map((label) =>
      naverJson<Basic>(`https://m.stock.naver.com/api/index/${label}/basic`).then((item) => [{ label, value: number(item.closePrice), change: number(item.fluctuationsRatio), asOf: item.localTradedAt }])),
    naverJson<{ result: Basic }>('https://m.stock.naver.com/front-api/marketIndex/productDetail?category=exchange&reutersCode=FX_USDKRW').then(({ result }) => [{ label: 'USD/KRW', value: number(result.closePrice), change: number(result.fluctuationsRatio), asOf: result.localTradedAt }]),
    ...[['.IXIC', 'NASDAQ'], ['.INX', 'S&P 500']].map(([code, label]) =>
      naverJson<Basic>(`https://api.stock.naver.com/index/${code}/basic`).then((item) => [{ label, value: number(item.closePrice), change: number(item.fluctuationsRatio), asOf: item.localTradedAt }])),
  ]);
  return jobs.flatMap((job) => job.status === 'fulfilled' ? job.value : []);
}

export async function readMinutes(market: Market, code: string, index = false, afterMarket = false): Promise<MinuteSeries> {
  const region = domestic(market) ? 'domestic' : 'foreign';
  const data = await naverJson<{
    tradeBaseAt: string; lastClosePrice: number; localDateTimeNow: string;
    priceInfos: { localDateTime: string; currentPrice: number }[];
  }>(`https://api.stock.naver.com/chart/${region}/${index ? 'index' : 'item'}/${encodeURIComponent(code)}?periodType=day`, 15000);
  if (!data.tradeBaseAt || !Array.isArray(data.priceInfos)) throw new Error('분봉 데이터를 받지 못했습니다.');
  const start = domestic(market) ? afterMarket ? 480 : 540 : 570;
  // KRX2 uses one fixed 08:00–20:00 axis and only the three trading windows.
  const end = domestic(market) ? afterMarket ? 1200 : 930 : 960;
  const session = domestic(market)
    ? { start, end, timeZone: 'Asia/Seoul', ticks: afterMarket ? [480, 530, 540, 660, 780, 930, 960, 1080, 1200] : [540, 660, 780, 930] }
    : { start, end, timeZone: 'America/New_York', ticks: [570, 720, 840, 960] };
  return {
    market, code, date: data.tradeBaseAt, previousClose: data.lastClosePrice, asOf: data.localDateTimeNow,
    points: data.priceInfos.filter((item) => item.localDateTime.startsWith(data.tradeBaseAt)
      && item.localDateTime <= data.localDateTimeNow && item.currentPrice > 0).map((item) => ({
        minute: Number(item.localDateTime.slice(8, 10)) * 60 + Number(item.localDateTime.slice(10, 12)),
        price: item.currentPrice,
      })).filter((point) => point.minute >= start && point.minute <= end
        && (!domestic(market) || !afterMarket || point.minute <= 530 || (point.minute >= 540 && point.minute <= 930) || point.minute >= 960)), session,
  };
}

async function autocomplete(query: string): Promise<StockSelection[]> {
  // Provider search matches names internally as well as symbols/codes. Do not
  // apply a second prefix filter: e.g. 하이닉스 must retain SK하이닉스.
  const normalized = query.normalize('NFC').trim();
  if (!normalized) return [];
  const data = await naverJson<{ items?: { code: string; reutersCode: string; name: string; typeCode: string; nationCode: string; category: string; url: string }[] }>(`https://ac.stock.naver.com/ac?q=${encodeURIComponent(normalized)}&target=stock&st=111`, 60_000);
  return (data.items ?? []).filter((item) => ['KOR', 'USA'].includes(item.nationCode) && ['stock', 'etf'].includes(item.category)
    && ['KOSPI', 'KOSDAQ', 'NASDAQ', 'NYSE', 'AMEX'].includes(item.typeCode))
    .map((item) => ({ code: item.code, chartCode: item.reutersCode, name: item.name, market: item.typeCode as StockSelection['market'],
      ...(item.category === 'etf' || item.url.includes('/etf/') ? { instrumentType: 'etf' as const } : {}) }));
}

export async function searchStocks(query: string): Promise<StockSelection[]> {
  const [primary, catalog] = await Promise.allSettled([autocomplete(query), searchUsSymbols(query)]);
  const initial = primary.status === 'fulfilled' ? primary.value : [];
  const candidates = catalog.status === 'fulfilled' ? catalog.value.filter((item) => !initial.some((existing) => existing.code === item.code)) : [];
  // Resolve exact tickers through Naver, never guess Reuters suffixes or exchanges.
  const resolved: StockSelection[] = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, async () => {
    while (cursor < candidates.length) {
      const candidate = candidates[cursor++];
      try {
        const match = (await autocomplete(candidate.code)).find((item) => !domestic(item.market) && item.code.toUpperCase() === candidate.code.toUpperCase());
        if (match) resolved.push({ ...match, ...(candidate.etf ? { instrumentType: 'etf' as const } : {}) });
      } catch { /* Keep other results if this symbol is unavailable at the provider. */ }
    }
  }));
  if (primary.status === 'rejected' && !resolved.length) throw primary.reason;
  resolved.sort((a, b) => a.code.localeCompare(b.code));
  return [...new Map([...initial, ...resolved].map((item) => [`${item.market}:${item.chartCode}`, item])).values()].slice(0, 20);
}

// Same bank-quoted USD/KRW series as the header. Keep only the last real quote
// in each minute; missing minutes are not fabricated or forward-filled.
export async function readFxMinutes(): Promise<MinuteSeries> {
  const data = await naverJson<{ result: {
    tradeBaseAt: string; localDateTimeNow: string; lastClosePrice: number;
    priceInfos: { localDateTime: string; currentPrice: number }[];
  } }>('https://m.stock.naver.com/front-api/chart/pricesByPeriod?reutersCode=FX_USDKRW&chartInfoType=exchange&scriptChartType=day&category=exchange', 15000);
  const result = data.result;
  if (!result || !/^\d{8}$/.test(result.tradeBaseAt) || !Array.isArray(result.priceInfos)) throw new Error('환율 차트 수신 실패');
  const perMinute = new Map<number, { minute: number; price: number }>();
  for (const point of [...result.priceInfos].sort((a, b) => a.localDateTime.localeCompare(b.localDateTime))) {
    if (!/^\d{14}$/.test(point.localDateTime) || !point.localDateTime.startsWith(result.tradeBaseAt)
      || point.localDateTime > result.localDateTimeNow || !Number.isFinite(point.currentPrice) || point.currentPrice <= 0) continue;
    const minute = Number(point.localDateTime.slice(8, 10)) * 60 + Number(point.localDateTime.slice(10, 12));
    if (minute < 1440) perMinute.set(minute, { minute, price: point.currentPrice });
  }
  // Fixed Korean stock-session window; never stretch the latest quote to the right edge.
  const session = { start: 540, end: 930, timeZone: 'Asia/Seoul', ticks: [540, 660, 780, 930] };
  const points = [...perMinute.values()].filter((point) => point.minute >= session.start && point.minute <= session.end);
  return { market: 'FX', code: 'FX_USDKRW', date: result.tradeBaseAt, previousClose: result.lastClosePrice,
    asOf: result.localDateTimeNow, points,
    session,
  };
}

export async function readQuote(market: Market, code: string, afterMarket = false, now = new Date()): Promise<Quote> {
  const root = domestic(market) ? 'https://m.stock.naver.com/api' : 'https://api.stock.naver.com';
  const stock = await naverJson<Stock>(`${root}/stock/${encodeURIComponent(code)}/basic`);
  if (!['stock', 'etf'].includes(stock.stockEndType)) throw new Error('주식 또는 ETF 종목이 아닙니다.');
  if (domestic(market) && !Number.isFinite(number(stock.accumulatedTradingVolume ?? stock.tradeVolume ?? stock.volume))) {
    const volume = await readDomesticRealtimeVolume(code);
    if (volume !== undefined) stock.accumulatedTradingVolume = volume;
  }
  if (!domestic(market) && !Number.isFinite(number(stock.accumulatedTradingVolume ?? stock.tradeVolume ?? stock.volume))) {
    const volume = await readForeignVolume(code);
    if (volume !== undefined) stock.accumulatedTradingVolume = volume;
  }
  if (afterMarket && domestic(market)) {
    const after = (await readDomesticAfterPrices([code])).get(code);
    if (after) stock.overMarketPriceInfo = after;
  }
  return quoteFrom(stock, market, afterMarket, now);
}

// Provider's genuine daily OHLC. Do not manufacture US minute candles from closes.
export async function readCandles(market: Market, code: string): Promise<CandleSeries> {
  const region = domestic(market) ? 'domestic' : 'foreign';
  const data = await naverJson<{ priceInfos: { localDate: string; openPrice: number; highPrice: number; lowPrice: number; closePrice: number }[] }>(`https://api.stock.naver.com/chart/${region}/item/${encodeURIComponent(code)}?periodType=month`, 15_000);
  if (!Array.isArray(data.priceInfos)) throw new Error('봉 데이터가 없습니다.');
  const candles = data.priceInfos.filter((bar) => /^\d{8}$/.test(bar.localDate)
    && [bar.openPrice, bar.highPrice, bar.lowPrice, bar.closePrice].every((value) => Number.isFinite(value) && value > 0)
    && bar.highPrice >= Math.max(bar.openPrice, bar.closePrice) && bar.lowPrice <= Math.min(bar.openPrice, bar.closePrice))
    .map((bar) => ({ date: bar.localDate, open: bar.openPrice, high: bar.highPrice, low: bar.lowPrice, close: bar.closePrice })).sort((a, b) => a.date.localeCompare(b.date));
  if (!candles.length) throw new Error('봉 데이터가 없습니다.');
  return { code, interval: 'day', candles };
}
