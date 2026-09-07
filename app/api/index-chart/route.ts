import { readMinutes } from '@/lib/naver';
import type { MinuteSeries, Market } from '@/lib/market-types';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET() {
  const series: Record<string, MinuteSeries> = {};
  await Promise.all((['KOSPI', 'KOSDAQ', 'NASDAQ'] as Market[]).map(async (market) => {
    try { series[market] = await readMinutes(market, market === 'NASDAQ' ? '.IXIC' : market, true); }
    catch { /* Missing data stays missing, never replace with a synthetic trend. */ }
  }));
  return Response.json({ series }, { headers: { 'Cache-Control': 'no-store' } });
}
