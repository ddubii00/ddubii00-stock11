import { readIndices, readStocks } from '@/lib/naver';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const market = url.searchParams.get('market')?.toUpperCase() ?? 'KOSPI';
  if (market !== 'KOSPI' && market !== 'KOSDAQ' && market !== 'NASDAQ') {
    return Response.json({ error: '지원하지 않는 시장입니다.' }, { status: 400 });
  }
  try {
    const [stocks, indices] = await Promise.all([
      readStocks(market), url.searchParams.get('indices') === '1' ? readIndices() : Promise.resolve([]),
    ]);
    return Response.json({ ...stocks, indices }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '시세 조회 실패' }, { status: 502 });
  }
}
