import { readQuote } from '@/lib/naver';
import { parseSymbols, symbolKey } from '@/lib/watchlist';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function GET(request: Request) {
  const items = parseSymbols(new URL(request.url).searchParams.get('symbols') ?? '');
  if (!items) return Response.json({ error: '한 번에 1~32개의 올바른 종목을 요청하세요.' }, { status: 400 });
  const quotes: Record<string, Awaited<ReturnType<typeof readQuote>>> = {}, errors: Record<string, string> = {};
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++], key = symbolKey(item);
      try { quotes[key] = await readQuote(item.market, item.chartCode); }
      catch { errors[key] = '시세 수신 대기'; }
    }
  }));
  return Response.json({ quotes, errors }, { headers: { 'Cache-Control': 'no-store' } });
}
