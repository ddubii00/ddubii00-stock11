import { redisKey, withRedis } from './redis';
import { sqliteStore } from './sqlite-store';

export type Store = {
  get(key: string): Promise<string | null>;
  cas(key: string, previous: string | null, next: string, ttl?: number): Promise<boolean>;
  remove(key: string): Promise<void>;
};
export function redisStore(): Store {
  return {
    get: (key) => withRedis((client) => client.get(key)),
    async cas(key, previous, next, ttl = 0) {
      const script = "local v=redis.call('GET',KEYS[1]); if (ARGV[1]=='missing' and v) or (ARGV[1]=='exists' and v~=ARGV[2]) then return 0 end; redis.call('SET',KEYS[1],ARGV[3]); if tonumber(ARGV[4])>0 then redis.call('EXPIRE',KEYS[1],ARGV[4]) end; return 1";
      return await withRedis((client) => client.eval(script, { keys: [key], arguments: [previous === null ? 'missing' : 'exists', previous ?? '', next, String(ttl)] })) === 1;
    },
    async remove(key) { await withRedis((client) => client.del(key)); },
  };
}
export function syncConfiguration() {
  if (process.env.STOCK11_SYNC_ENABLED === 'false') return null;
  const requested = process.env.STOCK11_PROFILE_STORE?.toLowerCase();
  if (requested && requested !== 'redis' && requested !== 'sqlite') throw new Error('서버 저장 방식 설정 오류');
  const store = requested ?? (process.env.REDIS_URL ? 'redis' : null);
  if (!store || (store === 'redis' && !process.env.REDIS_URL)) return null;
  const password = process.env.STOCK11_SYNC_PASSWORD ?? '';
  // A Redis connection alone must never enable public state access or writes.
  if (!password) return null;
  if (password.length < 4 || password.length > 256) throw new Error('로그인 비밀번호 설정 오류');
  const origin = process.env.STOCK11_SYNC_ORIGIN;
  if (origin) {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsed.hostname))) throw new Error('HTTPS 접속 주소 설정 오류');
  }
  const userId = process.env.STOCK11_USER_ID || 'personal';
  return { password, origin, userId, namespace: redisKey('user', userId), store, location: store === 'sqlite' ? 'Oracle 서버' : 'Redis Cloud' };
}
export async function configuredStore(): Promise<Store> {
  const config = syncConfiguration();
  if (!config) throw new Error('서버 저장 설정이 필요합니다.');
  return config.store === 'sqlite' ? sqliteStore() : redisStore();
}
