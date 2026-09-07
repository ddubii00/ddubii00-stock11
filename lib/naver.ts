import type { Market, MinuteSeries, MarketPayload, IndexQuote } from './market-types';

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
};
type Basic = { closePrice: string; fluctuationsRatio: string; localTradedAt: string };

export async function readStocks(market: Market): Promise<Omit<MarketPayload, 'indices'>> {
  const url = (page: number) => market === 'NASDAQ'
    ? `https://api.stock.naver.com/stock/exchange/NASDAQ/marketValue?page=${page}&pageSize=100`
    : `https://m.stock.naver.com/api/stocks/marketValue/${market}?page=${page}&pageSize=100`;
  const first = await naverJson<{ stocks: Stock[] }>(url(1));
  let stocks = (first.stocks ?? []).filter((stock) => stock.stockEndType === 'stock');
  for (let page = 2; stocks.length < 100 && page <= 3; page++) {
    const more = await naverJson<{ stocks: Stock[] }>(url(page));
    if (!more.stocks?.length) break;
    stocks.push(...more.stocks.filter((stock) => stock.stockEndType === 'stock'));
  }
  stocks = [...new Map(stocks.map((stock) => [stock.itemCode ?? stock.reutersCode, stock])).values()].slice(0, 100);
  if (!stocks.length) throw new Error('종목 데이터를 받지 못했습니다.');
  return {
    // closePrice is the regular-session value. Do not use overMarketPriceInfo (NXT/after-hours).
    stocks: stocks.map((stock) => ({
      code: stock.symbolCode ?? stock.itemCode ?? stock.reutersCode ?? '',
      chartCode: stock.itemCode ?? stock.reutersCode ?? '',
      name: stock.stockName,
      price: number(stock.closePrice),
      previousClose: number(stock.closePrice) - number(stock.compareToPreviousClosePrice),
      change: number(stock.fluctuationsRatio),
      changePrice: number(stock.compareToPreviousClosePrice),
      turnover: market === 'NASDAQ' ? stock.accumulatedTradingValue ?? '—' : stock.accumulatedTradingValueKrwHangeul ?? '—',
      asOf: stock.localTradedAt,
    })),
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

export async function readMinutes(market: Market, code: string): Promise<MinuteSeries> {
  const region = market === 'NASDAQ' ? 'foreign' : 'domestic';
  const data = await naverJson<{
    tradeBaseAt: string; lastClosePrice: number; localDateTimeNow: string;
    priceInfos: { localDateTime: string; currentPrice: number }[];
  }>(`https://api.stock.naver.com/chart/${region}/item/${encodeURIComponent(code)}?periodType=day`, 15000);
  if (!data.tradeBaseAt || !Array.isArray(data.priceInfos)) throw new Error('분봉 데이터를 받지 못했습니다.');
  const start = market === 'NASDAQ' ? 570 : 540;
  const end = market === 'NASDAQ' ? 960 : 930;
  return {
    market, code, date: data.tradeBaseAt, previousClose: data.lastClosePrice, asOf: data.localDateTimeNow,
    points: data.priceInfos.filter((item) => item.localDateTime.startsWith(data.tradeBaseAt)
      && item.localDateTime <= data.localDateTimeNow && item.currentPrice > 0).map((item) => ({
        minute: Number(item.localDateTime.slice(8, 10)) * 60 + Number(item.localDateTime.slice(10, 12)),
        price: item.currentPrice,
      })).filter((point) => point.minute >= start && point.minute <= end),
  };
}
