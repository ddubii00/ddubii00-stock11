import { readMinutes, readCandles } from '@/lib/naver';
import { parseSymbols, symbolKey } from '@/lib/watchlist';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const market = params.get('market');
  const mixed = params.has('symbols');
  const items = parseSymbols(mixed ? params.get('symbols')! : (params.get('codes') ?? '').split(',').map((code) => `${market}:${code}`).join(','));
  if (!items) {
    return Response.json({ error: '시장 또는 종목코드가 올바르지 않습니다.' }, { status: 400 });
  }
  const series: Record<string, Awaited<ReturnType<typeof readMinutes>>> = {};
  const errors: Record<string, string> = {};
  const candles: Record<string, Awaited<ReturnType<typeof readCandles>>> = {};
  let cursor = 0;
  // Naver's chart endpoint can take several seconds from Oracle. Eight bounded
  // workers keep a 30-stock page within the request window without opening an
  // unbounded fan-out that could stall the Node process.
  await Promise.all(Array.from({ length: Math.min(8, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++], key = mixed ? symbolKey(item) : item.chartCode;
      try {
        if (params.get('kind') === 'candles') candles[key] = await readCandles(item.market, item.chartCode);
        else series[key] = await readMinutes(item.market, item.chartCode);
      } catch { errors[key] = '차트 수신 대기'; }
    }
  }));
  return Response.json({ series, candles, errors }, { headers: { 'Cache-Control': 'no-store' } });
}
