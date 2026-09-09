import { configuredStore, syncConfiguration } from './profile-store';
import { authenticated, digest, ProfileError, SESSION_AGE } from './profile-service';

export const privateJson = (value: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(value, {
  status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff', ...headers },
});
export const profileFailure = (error: unknown) => privateJson({ error: error instanceof ProfileError ? error.message : '서버 저장 연결을 확인해 주세요.' }, error instanceof ProfileError ? error.status : 503);
export function requireConfiguration() {
  const config = syncConfiguration();
  if (!config) throw new ProfileError('서버 저장 설정이 필요합니다.', 503);
  return config;
}
export const cookieName = (namespace: string) => `stock11_session_${digest(namespace).slice(0, 12)}`;
export function tokenFrom(request: Request, namespace: string) {
  return (request.headers.get('cookie') ?? '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName(namespace)}=`))?.slice(cookieName(namespace).length + 1) ?? '';
}
export function sessionCookie(namespace: string, token: string, secure: boolean) {
  return `${cookieName(namespace)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? SESSION_AGE : 0}${secure ? '; Secure' : ''}`;
}
export async function authorized(request: Request) {
  const config = requireConfiguration(), store = await configuredStore();
  if (!await authenticated(store, config.namespace, config.password, tokenFrom(request, config.namespace))) throw new ProfileError('로그인이 필요합니다.', 401);
  return { config, store };
}
export function requestOrigin(request: Request, configured?: string) {
  const url = new URL(configured ?? request.url);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new ProfileError('HTTPS 접속이 필요합니다.', 403);
  return url.origin;
}
export function checkOrigin(request: Request, origin?: string) {
  if (request.headers.get('origin') !== requestOrigin(request, origin) || request.headers.get('sec-fetch-site') === 'cross-site') throw new ProfileError('허용되지 않은 요청입니다.', 403);
}
export async function jsonBody(request: Request, maxBytes = 128000): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new ProfileError('JSON 요청이 필요합니다.', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new ProfileError('요청 내용이 없습니다.', 400);
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw new ProfileError('요청이 너무 큽니다.', 413); }
      chunks.push(part.value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new ProfileError('요청 내용을 읽을 수 없습니다.', 400); }
  } finally { reader.releaseLock(); }
}
