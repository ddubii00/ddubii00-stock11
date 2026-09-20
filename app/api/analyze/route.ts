import { analyzeCoreSignal, type SignalBar } from '@/lib/core-signal';
import { parseSymbols, symbolKey } from '@/lib/watchlist';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const number = (value: string | undefined) => Number(String(value ?? '').replaceAll(',', ''));
async function history(code: string): Promise<SignalBar[]> {
  const response = await fetch(`https://fchart.stock.naver.com/sise.nhn?symbol=${encodeURIComponent(code)}&timeframe=day&count=500&requestType=0`, { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store', signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`history ${response.status}`);
  const xml = await response.text();
  return [...xml.matchAll(/<item\s+data="([^"]+)"\s*\/>/g)].map((match) => match[1].split('|')).filter((row) => row.length >= 6).map((row) => ({ date: row[0], open: number(row[1]), high: number(row[2]), low: number(row[3]), close: number(row[4]), volume: number(row[5]) })).filter((row) => /^\d{8}$/.test(row.date) && [row.open, row.high, row.low, row.close, row.volume].every(Number.isFinite));
}
export async function GET(request: Request) {
  const items = parseSymbols(new URL(request.url).searchParams.get('symbols') ?? '');
  if (!items || items.length > 32) return Response.json({ error: '분석 종목은 1~32개까지입니다.' }, { status: 400 });
  const signals: Record<string, ReturnType<typeof analyzeCoreSignal>> = {}, errors: Record<string, string> = {};
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => { while (cursor < items.length) { const item = items[cursor++], key = symbolKey(item), code = item.chartCode.match(/^(\d{6})(?:\.(?:KS|KQ))?$/i)?.[1]; if (!code || !['KOSPI', 'KOSDAQ'].includes(item.market)) { errors[key] = '한국 CORE 일봉만 분석합니다.'; continue; } try { signals[key] = analyzeCoreSignal(await history(code)); } catch (error) { errors[key] = error instanceof Error ? error.message : '분석 실패'; } } }));
  return Response.json({ signals, errors }, { headers: { 'Cache-Control': 'no-store' } });
}
