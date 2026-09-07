import { readMinutes } from '@/lib/naver';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const market = params.get('market');
  const codes = [...new Set((params.get('codes') ?? '').split(',').filter(Boolean))];
  if ((market !== 'KOSPI' && market !== 'KOSDAQ' && market !== 'NASDAQ') || !codes.length || codes.length > 32
    || codes.some((code) => !/^[A-Za-z0-9.^-]{1,24}$/.test(code))) {
    return Response.json({ error: '시장 또는 종목코드가 올바르지 않습니다.' }, { status: 400 });
  }
  const series: Record<string, Awaited<ReturnType<typeof readMinutes>>> = {};
  const errors: Record<string, string> = {};
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, codes.length) }, async () => {
    while (cursor < codes.length) {
      const code = codes[cursor++];
      try { series[code] = await readMinutes(market, code); }
      catch { errors[code] = '분봉 수신 대기'; }
    }
  }));
  return Response.json({ series, errors }, { headers: { 'Cache-Control': 'no-store' } });
}
