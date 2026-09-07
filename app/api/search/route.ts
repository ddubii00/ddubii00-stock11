import { searchStocks } from '@/lib/naver';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  if (!query || query.length > 60) return Response.json({ items: [] }, { status: query.length > 60 ? 400 : 200 });
  try { return Response.json({ items: await searchStocks(query) }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return Response.json({ error: '검색 연결 실패. 다시 입력해 주세요.' }, { status: 502 }); }
}
