import { withRedis } from '@/lib/redis';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const pong = await withRedis((client) => client.ping());
    if (pong !== 'PONG') throw new Error('Redis unavailable');
    return Response.json({ ok: true, redis: 'connected' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ ok: false, redis: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
