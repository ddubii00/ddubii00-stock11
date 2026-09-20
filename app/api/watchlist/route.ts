import { readQuote } from '@/lib/naver';
import { kisEnabled, readKisQuoteResult } from '@/lib/kis-relay';
import { parseSymbols, symbolKey } from '@/lib/watchlist';
import type { Market, Quote } from '@/lib/market-types';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
const domestic = (market: Market): market is 'KOSPI' | 'KOSDAQ' => market === 'KOSPI' || market === 'KOSDAQ';
export async function GET(request: Request) {
  const url = new URL(request.url);
  const items = parseSymbols(url.searchParams.get('symbols') ?? '', 200);
  const afterMarket = url.searchParams.get('after') === '1';
  if (!items) return Response.json({ error: '한 번에 1~200개의 올바른 종목을 요청하세요.' }, { status: 400 });
  const quotes: Record<string, Quote> = {}, errors: Record<string, string> = {};
  const fallback = [] as typeof items;
  const grouped = new Map<'KOSPI' | 'KOSDAQ', typeof items>();
  for (const item of items) {
    if (domestic(item.market) && kisEnabled()) grouped.set(item.market, [...(grouped.get(item.market) ?? []), item]);
    else fallback.push(item);
  }
  // Domestic watchlists use KIS's 30-code multi REST endpoint first. Naver
  // is reached only for a KIS-missing item (or overseas symbols).
  await Promise.all([...grouped].map(async ([market, group]) => {
    const result = await readKisQuoteResult(market, group.map((item) => item.chartCode), afterMarket, 'watch');
    for (const item of group) {
      const live = result.quotes[item.chartCode];
      if (!live) { fallback.push(item); continue; }
      quotes[symbolKey(item)] = {
        code: item.chartCode, chartCode: item.chartCode, name: live.name ?? item.chartCode, market,
        price: live.price, previousClose: live.previousClose, change: live.change, changePrice: live.changePrice,
        turnover: '—', volume: live.volume, asOf: live.asOf, fetchedAt: live.fetchedAt,
        marketStatus: live.marketStatus, priceSource: live.priceSource ?? 'kis-multi-rest', priceSession: live.priceSession,
      };
    }
  }));
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, fallback.length) }, async () => {
    while (cursor < fallback.length) {
      const item = fallback[cursor++], key = symbolKey(item);
      try { quotes[key] = await readQuote(item.market, item.chartCode, afterMarket); }
      catch { errors[key] = '시세 수신 대기'; }
    }
  }));
  const domesticCount = items.filter((item) => domestic(item.market)).length;
  return Response.json({ quotes, errors, source: domesticCount && kisEnabled() ? 'KIS REST' : '네이버 증권' }, { headers: { 'Cache-Control': 'no-store' } });
}
