import type { Market, MinuteSeries, MarketPayload, IndexQuote, Quote, StockSelection, CandleSeries } from './market-types';

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

const number = (value: string | number | undefined | null) => Number(String(value ?? '').replaceAll(',', ''));
type Stock = {
  stockEndType: string; itemCode?: string; reutersCode?: string; symbolCode?: string;
  stockName: string; closePrice: string; compareToPreviousClosePrice: string; fluctuationsRatio: string;
  accumulatedTradingValueKrwHangeul?: string; accumulatedTradingValue?: string;
  marketStatus: string; localTradedAt: string;
  stockExchangeType?: { name: string };
};
type Basic = { closePrice: string; fluctuationsRatio: string; localTradedAt: string };

const domestic = (market: Market) => market === 'KOSPI' || market === 'KOSDAQ';
function exchange(stock: Stock, fallback: Market): StockSelection['market'] {
  const name = stock.stockExchangeType?.name;
  return name === 'KOSPI' || name === 'KOSDAQ' || name === 'NASDAQ' || name === 'NYSE' || name === 'AMEX' ? name : fallback === 'SP500' ? 'NYSE' : fallback;
}
function quoteFrom(stock: Stock, fallback: Market): Quote {
  const market = exchange(stock, fallback);
  const price = number(stock.closePrice), changePrice = number(stock.compareToPreviousClosePrice), change = number(stock.fluctuationsRatio);
  if (![price, changePrice, change].every(Number.isFinite) || price <= 0) throw new Error('유효한 현재가가 없습니다.');
  return {
    code: stock.symbolCode ?? stock.itemCode ?? stock.reutersCode ?? '', chartCode: stock.itemCode ?? stock.reutersCode ?? '',
    name: stock.stockName, market, marketStatus: stock.marketStatus, price, changePrice, change, previousClose: price - changePrice,
    turnover: domestic(market) ? stock.accumulatedTradingValueKrwHangeul ?? '—' : stock.accumulatedTradingValue ?? '—', asOf: stock.localTradedAt,
  };
}

export async function readStocks(market: Market): Promise<Omit<MarketPayload, 'indices'>> {
  const url = (page: number) => market === 'SP500'
    ? `https://api.stock.naver.com/index/.INX/stocks?page=${page}&pageSize=100`
    : !domestic(market)
    ? `https://api.stock.naver.com/stock/exchange/${market}/marketValue?page=${page}&pageSize=100`
    : `https://m.stock.naver.com/api/stocks/marketValue/${market}?page=${page}&pageSize=100`;
  let stocks: Stock[] = [];
  for (let page = 1; stocks.length < 200 && page <= 4; page++) {
    const data = await naverJson<{ stocks: Stock[] } | Stock[]>(url(page));
    const more = Array.isArray(data) ? data : data.stocks;
    if (!more?.length) break;
    stocks = [...new Map([...stocks, ...more.filter((stock) => stock.stockEndType === 'stock')].map((stock) => [stock.itemCode ?? stock.reutersCode, stock])).values()];
  }
  stocks = stocks.slice(0, 200);
  if (!stocks.length) throw new Error('종목 데이터를 받지 못했습니다.');
  return {
    // closePrice is the regular-session value. Do not use overMarketPriceInfo (NXT/after-hours).
    stocks: stocks.map((stock) => quoteFrom(stock, market)),
    marketStatus: stocks[0].marketStatus,
    asOf: stocks.reduce((latest, stock) => stock.localTradedAt > latest ? stock.localTradedAt : latest, stocks[0].localTradedAt),
    source: '네이버 증권',
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

export async function readMinutes(market: Market, code: string, index = false): Promise<MinuteSeries> {
  const region = domestic(market) ? 'domestic' : 'foreign';
  const data = await naverJson<{
    tradeBaseAt: string; lastClosePrice: number; localDateTimeNow: string;
    priceInfos: { localDateTime: string; currentPrice: number }[];
  }>(`https://api.stock.naver.com/chart/${region}/${index ? 'index' : 'item'}/${encodeURIComponent(code)}?periodType=day`, 15000);
  if (!data.tradeBaseAt || !Array.isArray(data.priceInfos)) throw new Error('분봉 데이터를 받지 못했습니다.');
  const start = domestic(market) ? 540 : 570;
  const end = domestic(market) ? 930 : 960;
  return {
    market, code, date: data.tradeBaseAt, previousClose: data.lastClosePrice, asOf: data.localDateTimeNow,
    points: data.priceInfos.filter((item) => item.localDateTime.startsWith(data.tradeBaseAt)
      && item.localDateTime <= data.localDateTimeNow && item.currentPrice > 0).map((item) => ({
        minute: Number(item.localDateTime.slice(8, 10)) * 60 + Number(item.localDateTime.slice(10, 12)),
        price: item.currentPrice,
      })).filter((point) => point.minute >= start && point.minute <= end),
  };
}

export async function searchStocks(query: string): Promise<StockSelection[]> {
  const data = await naverJson<{ items?: { code: string; reutersCode: string; name: string; typeCode: string; nationCode: string; category: string; url: string }[] }>(`https://ac.stock.naver.com/ac?q=${encodeURIComponent(query)}&target=stock&st=111`, 60_000);
  return (data.items ?? []).filter((item) => ['KOR', 'USA'].includes(item.nationCode) && item.category === 'stock'
    && ['KOSPI', 'KOSDAQ', 'NASDAQ', 'NYSE', 'AMEX'].includes(item.typeCode) && !item.url.includes('/etf/'))
    .map((item) => ({ code: item.code, chartCode: item.reutersCode, name: item.name, market: item.typeCode as StockSelection['market'] }));
}

export async function readQuote(market: Market, code: string): Promise<Quote> {
  const root = domestic(market) ? 'https://m.stock.naver.com/api' : 'https://api.stock.naver.com';
  const stock = await naverJson<Stock>(`${root}/stock/${encodeURIComponent(code)}/basic`);
  if (stock.stockEndType !== 'stock') throw new Error('주식 종목이 아닙니다.');
  return quoteFrom(stock, market);
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
