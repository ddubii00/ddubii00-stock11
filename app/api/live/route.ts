// Oracle only. Credentials stay in the separate, loopback-only KIS relay.
export async function GET(request: Request) {
  if (process.env.STOCK11_DATA_PROVIDER !== 'kis') return Response.json({ error: 'KIS 모드가 아닙니다.' }, { status: 404 });
  const params = new URL(request.url).searchParams;
  const market = params.get('market');
  const codes = (params.get('codes') ?? '').split(',');
  if (!['KOSPI', 'KOSDAQ', 'NASDAQ'].includes(market ?? '') || !codes.length || codes.length > 100 || codes.some((code) => !/^[A-Za-z0-9.^-]{1,24}$/.test(code))) {
    return Response.json({ error: '종목코드가 올바르지 않습니다.' }, { status: 400 });
  }
  const url = new URL('/stream', process.env.KIS_RELAY_URL || 'http://127.0.0.1:8091');
  url.searchParams.set('market', market!);
  url.searchParams.set('codes', codes.join(','));
  try {
    const response = await fetch(url, { signal: request.signal, cache: 'no-store' });
    if (!response.ok || !response.body) throw new Error('Relay unavailable');
    return new Response(response.body, { headers: {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no',
    } });
  } catch { return Response.json({ error: 'KIS 연결 대기 · 30초 갱신 유지' }, { status: 503 }); }
}
