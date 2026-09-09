import { parseOperation } from '@/lib/profile';
import { readProfile, updateProfile, ProfileError } from '@/lib/profile-service';
import { authorized, checkOrigin, jsonBody, privateJson, profileFailure } from '@/lib/profile-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try { const { config, store } = await authorized(request); return privateJson({ profile: await readProfile(store, config.namespace) }); }
  catch (error) { return profileFailure(error); }
}
export async function PATCH(request: Request) {
  try {
    const { config, store } = await authorized(request); checkOrigin(request, config.origin);
    const body = await jsonBody(request) as { id?: unknown; operation?: unknown };
    if (!body || typeof body.id !== 'string' || !/^[a-f0-9-]{36}$/.test(body.id)) throw new ProfileError('잘못된 요청 번호입니다.', 400);
    let operation;
    try { operation = parseOperation(body.operation); } catch { throw new ProfileError('잘못된 변경 요청입니다.', 400); }
    return privateJson({ profile: await updateProfile(store, config.namespace, body.id, operation) });
  } catch (error) { return profileFailure(error); }
}
