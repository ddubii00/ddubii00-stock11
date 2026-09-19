import { readIndices, readStocks } from '@/lib/naver';
import { kisEnabled, mergeKisQuotes, readKisQuotes } from '@/lib/kis-relay';
import type { Quote } from '@/lib/market-types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

const priorityLimit = Math.max(1, Math.min(40, Number(process.env.KIS_REST_PRIORITY_LIMIT) || 16));
function priorityCodes(stocks: Quote[], visible: string | null, active: boolean) {
  const known = new Set(stocks.map((quote) => quote.chartCode));
  const requested = [...new Set((visible ?? '').split(',').filter((code) => /^[A-Za-z0-9.^-]{1,24}$/.test(code) && known.has(code)))];
  // Only the active board gets a bounded initial ranked fill. Other boards
  // remain Naver-backed until they become visible, avoiding 4×40 REST bursts.
  return (requested.length ? requested : active ? stocks.map((quote) => quote.chartCode) : []).slice(0, priorityLimit);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const market = url.searchParams.get('market')?.toUpperCase() ?? 'KOSPI';
  if (market !== 'KOSPI' && market !== 'KOSDAQ' && market !== 'NASDAQ' && market !== 'SP500' && market !== 'DOW') {
    return Response.json({ error: '지원하지 않는 시장입니다.' }, { status: 400 });
  }
  const afterMarket = url.searchParams.get('after') === '1';
  try {
    const [stocks, indices] = await Promise.all([
      readStocks(market, afterMarket), url.searchParams.get('indices') === '1' ? readIndices() : Promise.resolve([]),
    ]);
    // KIS REST is shared by every market, watchlist and browser. Prefer the
    // board actually on screen; do not issue four simultaneous 40-code bursts.
    const codes = priorityCodes(stocks.stocks, url.searchParams.get('visible'), url.searchParams.get('priority') === 'active');
    const kis = await readKisQuotes(market, codes, afterMarket);
    const merged = mergeKisQuotes(stocks.stocks, kis, afterMarket);
    const usedKis = Object.values(kis).some((quote) => quote.priceSession === (afterMarket ? 'after' : 'regular'));
    return Response.json({ ...stocks, stocks: merged, indices, source: usedKis && kisEnabled() ? `KIS 우선 · ${stocks.source} 보완` : stocks.source }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '시세 조회 실패' }, { status: 502 });
  }
}
