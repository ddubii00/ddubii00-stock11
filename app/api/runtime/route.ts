export async function GET() {
  return Response.json({ provider: process.env.STOCK11_DATA_PROVIDER === 'kis' ? 'kis' : 'naver', refreshMs: 30_000 }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
