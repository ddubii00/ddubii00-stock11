import { readQuote } from '@/lib/naver';
import { mergeKisQuotes, readKisQuotes } from '@/lib/kis-relay';
import { parseSymbols, symbolKey } from '@/lib/watchlist';
import type { Market } from '@/lib/market-types';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function GET(request: Request) {
  const url = new URL(request.url);
  const items = parseSymbols(url.searchParams.get('symbols') ?? '');
  const afterMarket = url.searchParams.get('after') === '1';
  if (!items) return Response.json({ error: '한 번에 1~32개의 올바른 종목을 요청하세요.' }, { status: 400 });
  const quotes: Record<string, Awaited<ReturnType<typeof readQuote>>> = {}, errors: Record<string, string> = {};
  let cursor = 0;
  // Keep Oracle first-load latency bounded while still limiting provider
  // concurrency; this is intentionally finite rather than Promise.all(items).
  await Promise.all(Array.from({ length: Math.min(8, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++], key = symbolKey(item);
      try { quotes[key] = await readQuote(item.market, item.chartCode, afterMarket); }
      catch { errors[key] = '시세 수신 대기'; }
    }
  }));
  // Query each exchange separately so a domestic KRX2 request can use KIS UN
  // without ever altering the matching regular-session quote.
  const grouped = new Map<Market, typeof items>();
  for (const item of items) grouped.set(item.market, [...(grouped.get(item.market) ?? []), item]);
  await Promise.all([...grouped].map(async ([market, group]) => {
    const known = group.map((item) => quotes[symbolKey(item)]).filter(Boolean);
    const kis = await readKisQuotes(market, known.map((quote) => quote.chartCode), afterMarket);
    for (const quote of mergeKisQuotes(known, kis, afterMarket)) quotes[symbolKey({ market: quote.market ?? market, chartCode: quote.chartCode })] = quote;
  }));
  return Response.json({ quotes, errors }, { headers: { 'Cache-Control': 'no-store' } });
}
