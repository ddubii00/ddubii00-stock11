import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { applyOperation, emptyProfile, restoreProfile, type Profile, type ProfileOperation } from './profile';
import type { Store } from './profile-store';
import { redisKey } from './redis';

export class ProfileError extends Error { constructor(message: string, public status: number) { super(message); } }
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const SESSION_AGE = 7 * 24 * 60 * 60;
type RecordValue = { profile: Profile; recent: string[] };
function decode(raw: string | null): RecordValue {
  if (raw === null) return { profile: emptyProfile(), recent: [] };
  const record = JSON.parse(raw) as RecordValue;
  const profile = restoreProfile(record.profile);
  if (!profile || !Array.isArray(record.recent) || record.recent.length > 200 || !record.recent.every((id) => typeof id === 'string')) throw new Error('저장 데이터 오류');
  record.profile = profile;
  return record;
}
export async function readProfile(store: Store, namespace: string) { return decode(await store.get(`${namespace}:state`)).profile; }
export async function updateProfile(store: Store, namespace: string, id: string, op: ProfileOperation): Promise<Profile> {
  const key = `${namespace}:state`;
  for (let retry = 0; retry < 8; retry++) {
    const raw = await store.get(key), record = decode(raw);
    if (record.recent.includes(id)) return record.profile;
    let changed: Profile;
    try { changed = applyOperation(record.profile, op); }
    catch (error) { throw new ProfileError(error instanceof Error ? error.message : '변경 실패', 409); }
    const profile = { ...changed, revision: record.profile.revision + 1, updatedAt: new Date().toISOString() };
    const next = JSON.stringify({ profile, recent: [...record.recent.slice(-199), id] });
    if (await store.cas(key, raw, next)) return profile;
  }
  throw new ProfileError('다른 기기에서 저장 중입니다. 다시 시도해 주세요.', 409);
}
export async function login(store: Store, namespace: string, expected: string, password: string): Promise<string> {
  const bucket = redisKey('system', 'login', digest(namespace), String(Math.floor(Date.now() / 600000)));
  let allowed = false;
  for (let retry = 0; retry < 8; retry++) {
    const raw = await store.get(bucket), count = Number(raw ?? 0);
    if (!Number.isSafeInteger(count) || count >= 20) throw new ProfileError('로그인 시도가 많습니다. 최대 10분 후 다시 시도해 주세요.', 429);
    if (await store.cas(bucket, raw, String(count + 1), 600)) { allowed = true; break; }
  }
  if (!allowed) throw new ProfileError('잠시 후 다시 로그인해 주세요.', 429);
  if (!timingSafeEqual(Buffer.from(digest(password)), Buffer.from(digest(expected)))) throw new ProfileError('비밀번호가 일치하지 않습니다.', 401);
  const token = randomBytes(32).toString('hex');
  if (!await store.cas(redisKey('system', 'session', digest(namespace), digest(token)), null, JSON.stringify({ passwordTag: digest(`${expected}:${token}`), expires: Date.now() + SESSION_AGE * 1000 }), SESSION_AGE)) throw new ProfileError('로그인 재시도가 필요합니다.', 503);
  return token;
}
export async function authenticated(store: Store, namespace: string, password: string, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return false;
  const raw = await store.get(redisKey('system', 'session', digest(namespace), digest(token)));
  if (!raw) return false;
  const session = JSON.parse(raw) as { passwordTag: string; expires: number };
  return session.expires > Date.now() && session.passwordTag === digest(`${password}:${token}`);
}
export async function logout(store: Store, namespace: string, token: string) {
  if (/^[a-f0-9]{64}$/.test(token)) await store.remove(redisKey('system', 'session', digest(namespace), digest(token)));
}
