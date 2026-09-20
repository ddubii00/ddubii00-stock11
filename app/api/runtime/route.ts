export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const kis = process.env.VERCEL !== '1' && process.env.STOCK11_DATA_PROVIDER === 'kis';
  const bounded = (value: string | undefined, fallback: number, minimum: number) => Math.max(minimum, Number(value) || fallback);
  return Response.json({ provider: kis ? 'kis' : 'naver', refreshMs: kis ? bounded(process.env.STOCK11_KIS_VISIBLE_REFRESH_MS, 3_000, 1_000) : 30_000,
    marketRefreshMs: kis ? bounded(process.env.STOCK11_KIS_VISIBLE_REFRESH_MS, 3_000, 1_000) : 30_000,
    watchRefreshMs: kis ? bounded(process.env.STOCK11_KIS_WATCHLIST_REFRESH_MS, 2_000, 500) : 30_000 }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
