export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Oracle only. Credentials stay in the private KIS relay, not the web app.
export async function GET(request: Request) {
  if (process.env.VERCEL === '1' || process.env.STOCK11_DATA_PROVIDER !== 'kis') return Response.json({ error: 'KIS 모드가 아닙니다.' }, { status: 404 });
  const params = new URL(request.url).searchParams;
  const market = params.get('market');
  const codes = (params.get('codes') ?? '').split(',');
  if (!['KOSPI', 'KOSDAQ', 'NASDAQ', 'NYSE', 'AMEX'].includes(market ?? '') || !codes.length || codes.length > 200 || codes.some((code) => !/^[A-Za-z0-9.^-]{1,24}$/.test(code))) {
    return Response.json({ error: '종목코드가 올바르지 않습니다.' }, { status: 400 });
  }
  const url = new URL('/stream', process.env.KIS_RELAY_URL || 'http://127.0.0.1:8091');
  url.searchParams.set('market', market!);
  url.searchParams.set('codes', codes.join(','));
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal.addEventListener('abort', abort, { once: true });
  if (request.signal.aborted) controller.abort();
  const timeout = setTimeout(abort, 8000);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    clearTimeout(timeout);
    if (!response.ok || !response.body) throw new Error('Relay unavailable');
    const reader = response.body.getReader();
    const cleanup = () => request.signal.removeEventListener('abort', abort);
    const body = new ReadableStream({
      async pull(stream) {
        try {
          const chunk = await reader.read();
          if (chunk.done) { cleanup(); stream.close(); }
          else stream.enqueue(chunk.value);
        } catch (error) { cleanup(); stream.error(error); }
      },
      async cancel() { cleanup(); controller.abort(); await reader.cancel().catch(() => {}); },
    });
    return new Response(body, { headers: {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no',
    } });
  } catch {
    clearTimeout(timeout); request.signal.removeEventListener('abort', abort); controller.abort();
    return Response.json({ error: 'KIS 연결 대기 · 30초 갱신 유지' }, { status: 503 });
  }
}
