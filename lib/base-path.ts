// Compiled into client code. Keep the Oracle subpath optional so Vercel stays at `/`.
const configured = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
export const BASE_PATH = configured === '/' ? '' : configured.replace(/\/+$/, '');
export const apiPath = (path: string) => `${BASE_PATH}${path.startsWith('/') ? path : `/${path}`}`;
