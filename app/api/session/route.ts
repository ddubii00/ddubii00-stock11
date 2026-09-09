import { configuredStore, syncConfiguration } from '@/lib/profile-store';
import { authenticated, login, logout, ProfileError } from '@/lib/profile-service';
import { checkOrigin, jsonBody, privateJson, profileFailure, requireConfiguration, requestOrigin, sessionCookie, tokenFrom } from '@/lib/profile-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const config = syncConfiguration();
    if (!config) return privateJson({ enabled: false, authenticated: false });
    const store = await configuredStore();
    return privateJson({ enabled: true, authenticated: await authenticated(store, config.namespace, config.password, tokenFrom(request, config.namespace)), location: config.location });
  } catch (error) { return profileFailure(error); }
}
export async function POST(request: Request) {
  try {
    const config = requireConfiguration(); checkOrigin(request, config.origin);
    const body = await jsonBody(request, 2048) as { password?: unknown };
    if (!body || typeof body.password !== 'string' || body.password.length > 256) throw new ProfileError('비밀번호를 입력해 주세요.', 400);
    const token = await login(await configuredStore(), config.namespace, config.password, body.password);
    return privateJson({ authenticated: true }, 200, { 'Set-Cookie': sessionCookie(config.namespace, token, requestOrigin(request, config.origin).startsWith('https:')) });
  } catch (error) { return profileFailure(error); }
}
export async function DELETE(request: Request) {
  try {
    const config = requireConfiguration(); checkOrigin(request, config.origin);
    await logout(await configuredStore(), config.namespace, tokenFrom(request, config.namespace));
    return privateJson({ authenticated: false }, 200, { 'Set-Cookie': sessionCookie(config.namespace, '', requestOrigin(request, config.origin).startsWith('https:')) });
  } catch (error) { return profileFailure(error); }
}
