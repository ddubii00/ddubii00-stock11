import { readIndices, readStocks } from '@/lib/naver';
import { kisEnabled, mergeKisQuotes, readKisQuotes } from '@/lib/kis-relay';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

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
    // KIS has a deliberately bounded REST budget.  The board's first 40
    // ranked rows are the priority set; all remaining rows retain an explicit
    // Naver fallback instead of faking KIS authority.
    const codes = stocks.stocks.slice(0, 40).map((quote) => quote.chartCode);
    const kis = await readKisQuotes(market, codes, afterMarket);
    const merged = mergeKisQuotes(stocks.stocks, kis, afterMarket);
    const usedKis = Object.values(kis).some((quote) => quote.priceSession === (afterMarket ? 'after' : 'regular'));
    return Response.json({ ...stocks, stocks: merged, indices, source: usedKis && kisEnabled() ? `KIS 우선 · ${stocks.source} 보완` : stocks.source }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '시세 조회 실패' }, { status: 502 });
  }
}
