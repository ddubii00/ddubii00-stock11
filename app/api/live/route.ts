import { readKisQuoteResult } from '@/lib/kis-relay';
import type { Market } from '@/lib/market-types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const REFRESH_MS = 3_000;
const encoder = new TextEncoder();

function sse(event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function marketClock(market: string) {
  const timeZone = ['NASDAQ', 'NYSE', 'AMEX'].includes(market) ? 'America/New_York' : 'Asia/Seoul';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date()).reduce<Record<string, string>>((out, part) => {
    out[part.type] = part.value;
    return out;
  }, {});

  return {
    date: `${parts.year}${parts.month}${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

// Compatibility SSE for the existing UI. It does NOT use a WebSocket.
// Every quote pushed to the browser comes from the same KIS REST relay.
export async function GET(request: Request) {
  if (process.env.VERCEL === '1' || process.env.STOCK11_DATA_PROVIDER !== 'kis') {
    return Response.json({ error: 'KIS 모드가 아닙니다.' }, { status: 404 });
  }

  const params = new URL(request.url).searchParams;
  const market = params.get('market');
  const codes = [...new Set((params.get('codes') ?? '').split(',').filter(Boolean))];

  if (!['NASDAQ', 'NYSE', 'AMEX'].includes(market ?? '')
    || !codes.length
    || codes.length > 200
    || codes.some((code) => !/^[A-Za-z0-9.^-]{1,24}$/.test(code))) {
    return Response.json({ error: '종목코드가 올바르지 않습니다.' }, { status: 400 });
  }

  let stop = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const cleanup = () => {
        if (stopped) return;
        stopped = true;
        if (timer) clearTimeout(timer);
        request.signal.removeEventListener('abort', cleanup);
        try { controller.close(); } catch { /* already closed */ }
      };

      stop = cleanup;
      request.signal.addEventListener('abort', cleanup, { once: true });

      const poll = async () => {
        if (stopped) return;
        try {
          const result = await readKisQuoteResult(market as Market, codes, false, 'visible');
          if (stopped) return;

          controller.enqueue(sse('status', {
            state: 'connected',
            subscribed: Object.keys(result.quotes).length,
            requested: codes.length,
            transport: 'KIS REST',
          }));

          const clock = marketClock(market!);
          for (const code of codes) {
            const quote = result.quotes[code];
            if (!quote || !Number.isFinite(quote.price) || quote.price <= 0) continue;
            controller.enqueue(sse('quote', {
              ...quote,
              code,
              market,
              date: clock.date,
              minute: clock.minute,
              priceSession: quote.priceSession ?? 'regular',
            }));
          }
        } catch {
          if (!stopped) {
            controller.enqueue(sse('status', {
              state: 'reconnecting',
              subscribed: 0,
              requested: codes.length,
              transport: 'KIS REST',
            }));
          }
        } finally {
          if (!stopped) timer = setTimeout(() => { void poll(); }, REFRESH_MS);
        }
      };

      void poll();
    },
    cancel() {
      stop();
    },
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  });
}
