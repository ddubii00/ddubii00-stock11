import { analyzeCoreSignal, type SignalBar } from '@/lib/core-signal';
import type { Market } from '@/lib/market-types';
import { parseSymbols, symbolKey } from '@/lib/watchlist';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const MAX_ANALYZE_SYMBOLS = 200;
const SIGNAL_CACHE_MS = 5 * 60_000;
type CoreSignalResult = ReturnType<typeof analyzeCoreSignal>;
const signalCache = new Map<string, { expiresAt: number; signal: CoreSignalResult }>();
const pendingSignals = new Map<string, Promise<CoreSignalResult>>();
const number = (value: string | undefined) => Number(String(value ?? '').replaceAll(',', ''));
const domestic = (market: Market) => market === 'KOSPI' || market === 'KOSDAQ';
const supported = (market: Market) => domestic(market) || ['NASDAQ', 'NYSE', 'AMEX'].includes(market);
async function history(item: { market: Market; chartCode: string }): Promise<SignalBar[]> {
  if (!domestic(item.market)) {
    const response = await fetch(`https://api.stock.naver.com/chart/foreign/item/${encodeURIComponent(item.chartCode)}?periodType=month&range=24`, { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`history ${response.status}`);
    const data = await response.json() as { priceInfos?: { localDate?: string; openPrice?: number; highPrice?: number; lowPrice?: number; closePrice?: number; accumulatedTradingVolume?: number }[] };
    return (data.priceInfos ?? []).map((row) => ({ date: String(row.localDate ?? ''), open: Number(row.openPrice), high: Number(row.highPrice), low: Number(row.lowPrice), close: Number(row.closePrice), volume: Number(row.accumulatedTradingVolume) })).filter((row) => /^\d{8}$/.test(row.date) && [row.open, row.high, row.low, row.close, row.volume].every(Number.isFinite));
  }
  const response = await fetch(`https://fchart.stock.naver.com/sise.nhn?symbol=${encodeURIComponent(item.chartCode)}&timeframe=day&count=500&requestType=0`, { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store', signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`history ${response.status}`);
  const xml = await response.text();
  return [...xml.matchAll(/<item\s+data="([^"]+)"\s*\/>/g)].map((match) => match[1].split('|')).filter((row) => row.length >= 6).map((row) => ({ date: row[0], open: number(row[1]), high: number(row[2]), low: number(row[3]), close: number(row[4]), volume: number(row[5]) })).filter((row) => /^\d{8}$/.test(row.date) && [row.open, row.high, row.low, row.close, row.volume].every(Number.isFinite));
}

async function signalFor(item: { market: Market; chartCode: string }): Promise<CoreSignalResult> {
  const key = symbolKey(item);
  const cached = signalCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.signal;
  const pending = pendingSignals.get(key);
  if (pending) return pending;
  const task = history(item).then(analyzeCoreSignal).then((signal) => {
    signalCache.set(key, { signal, expiresAt: Date.now() + SIGNAL_CACHE_MS });
    return signal;
  }).finally(() => pendingSignals.delete(key));
  pendingSignals.set(key, task);
  return task;
}

export async function GET(request: Request) {
  const items = parseSymbols(new URL(request.url).searchParams.get('symbols') ?? '', MAX_ANALYZE_SYMBOLS);
  if (!items) return Response.json({ error: `분석 종목은 1~${MAX_ANALYZE_SYMBOLS}개까지입니다.` }, { status: 400 });
  const signals: Record<string, CoreSignalResult> = {}, errors: Record<string, string> = {};
  let cursor = 0;
  // Daily signals are cached above; six workers make a large watchlist usable
  // without flooding the upstream daily-chart endpoint on every browser refresh.
  await Promise.all(Array.from({ length: Math.min(6, items.length) }, async () => { while (cursor < items.length) { const item = items[cursor++], key = symbolKey(item), domesticCode = item.chartCode.match(/^(\d{6})(?:\.(?:KS|KQ))?$/i)?.[1]; if (!supported(item.market) || (domestic(item.market) && !domesticCode)) { errors[key] = '한국·미국 CORE 일봉만 분석합니다.'; continue; } try { signals[key] = await signalFor({ market: item.market, chartCode: domesticCode ?? item.chartCode }); } catch (error) { errors[key] = error instanceof Error ? error.message : '분석 실패'; } } }));
  return Response.json({ signals, errors }, { headers: { 'Cache-Control': 'no-store' } });
}
