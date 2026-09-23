import { readIndices, readStocks } from '@/lib/naver';
import { kisEnabled, mergeKisQuotes, readKisQuotes } from '@/lib/kis-relay';
import type { Market, Quote } from '@/lib/market-types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

type RelayMarket = 'KOSPI' | 'KOSDAQ' | 'NASDAQ' | 'NYSE' | 'AMEX';
const relayMarkets = new Set<RelayMarket>(['KOSPI', 'KOSDAQ', 'NASDAQ', 'NYSE', 'AMEX']);

// Domestic KOSPI/KOSDAQ uses the KIS 30-symbol multi-price REST endpoint.
// The relay already batches larger lists into official 30-symbol chunks, so
// the active domestic board can request all 200 rows.
const overseasPriorityLimit = Math.max(1, Math.min(30, Number(process.env.KIS_REST_PRIORITY_LIMIT) || 30));

function requestedCodes(stocks: Quote[], market: string, visible: string | null, active: boolean) {
  if (!active) return [];

  if (market === 'KOSPI' || market === 'KOSDAQ') {
    return [...new Set(stocks.map((quote) => quote.chartCode))].slice(0, 200);
  }

  const known = new Set(stocks.map((quote) => quote.chartCode));
  const visibleCodes = [...new Set((visible ?? '').split(',').filter((code) =>
    /^[A-Za-z0-9.^-]{1,24}$/.test(code) && known.has(code)
  ))];

  return (visibleCodes.length ? visibleCodes : stocks.map((quote) => quote.chartCode))
    .slice(0, overseasPriorityLimit);
}

function relayMarketFor(quote: Quote, pageMarket: string): RelayMarket | undefined {
  if (quote.market && relayMarkets.has(quote.market as RelayMarket)) return quote.market as RelayMarket;
  if (relayMarkets.has(pageMarket as RelayMarket)) return pageMarket as RelayMarket;
  return undefined;
}

async function loadKisPrices(stocks: Quote[], codes: string[], pageMarket: string, afterMarket: boolean) {
  const wanted = new Set(codes);
  const groups = new Map<RelayMarket, string[]>();

  for (const quote of stocks) {
    if (!wanted.has(quote.chartCode)) continue;
    const market = relayMarketFor(quote, pageMarket);
    if (!market) continue;
    groups.set(market, [...(groups.get(market) ?? []), quote.chartCode]);
  }

  const parts = await Promise.all([...groups].map(async ([market, marketCodes]) => (
    readKisQuotes(market as Market, marketCodes, afterMarket, 'visible')
  )));

  return Object.assign({}, ...parts) as Record<string, Parameters<typeof mergeKisQuotes>[1][string]>;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const market = url.searchParams.get('market')?.toUpperCase() ?? 'KOSPI';

  if (!['KOSPI', 'KOSDAQ', 'NASDAQ', 'SP500', 'DOW'].includes(market)) {
    return Response.json({ error: '지원하지 않는 시장입니다.' }, { status: 400 });
  }

  if (!kisEnabled()) {
    return Response.json({ error: 'KIS REST 전용 모드가 설정되지 않았습니다.' }, { status: 503 });
  }

  const afterMarket = url.searchParams.get('after') === '1';

  try {
    const [stocks, indices] = await Promise.all([
      readStocks(market as Market, afterMarket),
      url.searchParams.get('indices') === '1' ? readIndices() : Promise.resolve([]),
    ]);

    const codes = requestedCodes(
      stocks.stocks,
      market,
      url.searchParams.get('visible'),
      url.searchParams.get('priority') === 'active',
    );

    const kis = await loadKisPrices(stocks.stocks, codes, market, afterMarket);
    const merged = mergeKisQuotes(stocks.stocks, kis, afterMarket);
    const marketStatus = merged.some((quote) => quote.marketStatus === 'PRE') ? 'PRE' : stocks.marketStatus;

    return Response.json({
      ...stocks,
      stocks: merged,
      marketStatus,
      indices,
      source: market === 'KOSPI' || market === 'KOSDAQ'
        ? 'KIS REST 전체 종목 · 30종목씩 자동 배치'
        : 'KIS REST only · 종목목록/분봉 메타데이터는 기존 소스 사용',
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : 'KIS 시세 조회 실패',
    }, { status: 502 });
  }
}
