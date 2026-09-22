import { readIndices, readStocks } from '@/lib/naver';
import { kisEnabled, mergeKisQuotes, readKisQuotes } from '@/lib/kis-relay';
import type { Market, Quote } from '@/lib/market-types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

type RelayMarket = 'KOSPI' | 'KOSDAQ' | 'NASDAQ' | 'NYSE' | 'AMEX';
const relayMarkets = new Set<RelayMarket>(['KOSPI', 'KOSDAQ', 'NASDAQ', 'NYSE', 'AMEX']);
const priorityLimit = Math.max(1, Math.min(30, Number(process.env.KIS_REST_PRIORITY_LIMIT) || 30));

function priorityCodes(stocks: Quote[], visible: string | null, active: boolean) {
  const known = new Set(stocks.map((quote) => quote.chartCode));
  const requested = [...new Set((visible ?? '').split(',').filter((code) =>
    /^[A-Za-z0-9.^-]{1,24}$/.test(code) && known.has(code)
  ))];

  return (requested.length ? requested : active ? stocks.map((quote) => quote.chartCode) : [])
    .slice(0, priorityLimit);
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

    const codes = priorityCodes(
      stocks.stocks,
      url.searchParams.get('visible'),
      url.searchParams.get('priority') === 'active',
    );

    const kis = await loadKisPrices(stocks.stocks, codes, market, afterMarket);
    const merged = mergeKisQuotes(stocks.stocks, kis, afterMarket);

    return Response.json({
      ...stocks,
      stocks: merged,
      indices,
      source: 'KIS REST only · 종목목록/분봉 메타데이터는 기존 소스 사용',
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : 'KIS 시세 조회 실패',
    }, { status: 502 });
  }
}
