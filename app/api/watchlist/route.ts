import { kisEnabled, readKisQuoteResult } from '@/lib/kis-relay';
import { parseSymbols, symbolKey } from '@/lib/watchlist';
import type { Market, Quote } from '@/lib/market-types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

type RelayMarket = 'KOSPI' | 'KOSDAQ' | 'NASDAQ' | 'NYSE' | 'AMEX';
const relayMarkets = new Set<RelayMarket>(['KOSPI', 'KOSDAQ', 'NASDAQ', 'NYSE', 'AMEX']);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const items = parseSymbols(url.searchParams.get('symbols') ?? '', 200);
  const afterMarket = url.searchParams.get('after') === '1';

  if (!items) {
    return Response.json({ error: '한 번에 1~200개의 올바른 종목을 요청하세요.' }, { status: 400 });
  }

  if (!kisEnabled()) {
    return Response.json({ error: 'KIS REST 전용 모드가 설정되지 않았습니다.' }, { status: 503 });
  }

  const quotes: Record<string, Quote> = {};
  const errors: Record<string, string> = {};
  const groups = new Map<RelayMarket, typeof items>();

  for (const item of items) {
    if (!relayMarkets.has(item.market as RelayMarket)) {
      errors[symbolKey(item)] = 'KIS REST 미지원 시장';
      continue;
    }
    const market = item.market as RelayMarket;
    groups.set(market, [...(groups.get(market) ?? []), item]);
  }

  await Promise.all([...groups].map(async ([market, group]) => {
    const result = await readKisQuoteResult(
      market as Market,
      group.map((item) => item.chartCode),
      afterMarket,
      'watch',
    );

    for (const item of group) {
      const live = result.quotes[item.chartCode];
      const key = symbolKey(item);

      if (!live || !Number.isFinite(live.price) || live.price <= 0) {
        errors[key] = 'KIS REST 시세 수신 대기';
        continue;
      }

      quotes[key] = {
        code: item.chartCode,
        chartCode: item.chartCode,
        name: live.name ?? item.chartCode,
        market,
        price: live.price,
        previousClose: live.previousClose,
        change: live.change,
        changePrice: live.changePrice,
        turnover: '—',
        volume: live.volume ?? '—',
        asOf: live.asOf || live.fetchedAt || '',
        fetchedAt: live.fetchedAt,
        marketStatus: live.marketStatus,
        priceSource: live.priceSource ?? 'kis-rest',
        priceSession: live.priceSession ?? 'regular',
        pending: false,
      };
    }
  }));

  return Response.json({
    quotes,
    errors,
    source: 'KIS REST only',
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
