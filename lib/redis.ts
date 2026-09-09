// Node-only shared module: Next.js Node routes and standalone Oracle workers
// import this same file. Never import it from a client component.
import { createClient } from 'redis';
import { createHash } from 'node:crypto';

const makeClient = () => createClient({ url: process.env.REDIS_URL, disableOfflineQueue: true,
  socket: { connectTimeout: 5000, reconnectStrategy: (retries: number) => retries >= 2 ? false : Math.min(250 * (retries + 1), 1000) } });
type Client = ReturnType<typeof makeClient>;
type Connection = { client: Client; fingerprint: string; connecting?: Promise<Client> };
const globalRedis = globalThis as typeof globalThis & { __stock11Redis?: Connection };
export function redisKey(area: 'user' | 'market' | 'signal' | 'realtime' | 'system', ...parts: string[]) {
  const prefix = process.env.STOCK11_REDIS_PREFIX || 'stock11';
  if (!['user', 'market', 'signal', 'realtime', 'system'].includes(area) || ![prefix, ...parts].every((part) => /^[A-Za-z0-9_-]{1,100}$/.test(part))) throw new Error('Invalid Redis key namespace');
  return [prefix, area, ...parts].join(':');
}
export async function getRedis(): Promise<Client> {
  if (typeof window !== 'undefined') throw new Error('Redis is server-only');
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('Redis unavailable');
  const fingerprint = createHash('sha256').update(url).digest('hex');
  let cached = globalRedis.__stock11Redis;
  if (!cached || cached.fingerprint !== fingerprint) {
    if (cached?.client.isOpen) cached.client.destroy();
    try {
      const client = makeClient();
      // Always handle error events; do not log the Error object, host or URL.
      client.on('error', () => {});
      cached = { client, fingerprint }; globalRedis.__stock11Redis = cached;
    } catch { throw new Error('Redis unavailable'); }
  }
  if (cached.client.isReady) return cached.client;
  if (!cached.connecting) {
    const entry = cached;
    entry.connecting = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let ready: (() => void) | undefined;
      try {
        const connect = entry.client.isOpen ? new Promise<void>((resolve) => { ready = resolve; entry.client.once('ready', ready); }) : entry.client.connect();
        await Promise.race([connect, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Redis unavailable')), 8000); })]);
        return entry.client;
      } catch {
        if (entry.client.isOpen) entry.client.destroy();
        throw new Error('Redis unavailable');
      } finally {
        if (timer) clearTimeout(timer);
        if (ready) entry.client.off('ready', ready);
        entry.connecting = undefined;
      }
    })();
  }
  const connection = cached.connecting;
  if (!connection) throw new Error('Redis unavailable');
  return connection;
}
export async function withRedis<T>(command: (client: Client) => Promise<T>): Promise<T> {
  const client = await getRedis();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([command(client), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { if (client.isOpen) client.destroy(); reject(new Error('Redis unavailable')); }, 8000);
    })]);
  } catch { throw new Error('Redis unavailable'); }
  finally { if (timer) clearTimeout(timer); }
}
// For standalone worker shutdown/tests only; HTTP handlers reuse connections.
export function closeRedis() {
  if (globalRedis.__stock11Redis?.client.isOpen) globalRedis.__stock11Redis.client.destroy();
  globalRedis.__stock11Redis = undefined;
}
