import { readMinutes, readFxMinutes } from '@/lib/naver';
import type { MinuteSeries, Market } from '@/lib/market-types';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET() {
  const series: Record<string, MinuteSeries> = {};
  await Promise.all([...(['KOSPI', 'KOSDAQ', 'NASDAQ', 'SP500'] as Market[]).map(async (market) => {
    try { series[market === 'SP500' ? 'S&P 500' : market] = await readMinutes(market, market === 'SP500' ? '.INX' : market === 'NASDAQ' ? '.IXIC' : market, true); }
    catch { /* Missing data stays missing, never replace with a synthetic trend. */ }
  }), (async () => {
    try { series['USD/KRW'] = await readFxMinutes(); }
    catch { /* Do not substitute a different FX quote source or a fake trend. */ }
  })()]);
  return Response.json({ series }, { headers: { 'Cache-Control': 'no-store' } });
}
