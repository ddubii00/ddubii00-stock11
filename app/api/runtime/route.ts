export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const kis = process.env.VERCEL !== '1' && process.env.STOCK11_DATA_PROVIDER === 'kis';
  const refreshMs = kis ? 3_000 : 30_000;

  return Response.json({
    provider: kis ? 'kis' : 'naver',
    refreshMs,
    marketRefreshMs: refreshMs,
    watchRefreshMs: refreshMs,
    transport: kis ? 'KIS REST only' : 'fallback',
    websocket: false,
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
