import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { applyOperation, emptyProfile } from '../lib/profile.ts';
const dom = new JSDOM('<html><body></body></html>', { url: 'https://stock.example' });
for (const key of ['window', 'document', 'navigator']) Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { renderHook, act, waitFor, cleanup } = await import('@testing-library/react');
const { useServerProfile, PROFILE_CACHE_KEY } = await import('../hooks/use-server-profile.ts');
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; cleanup(); dom.window.close(); });
const item = { code: 'QQQ', chartCode: 'QQQ.O', market: 'NASDAQ', name: 'QQQ', instrumentType: 'etf' };

void test('server wins over stale browser data; explicit import, immediate operations, retries and logout protect state', async () => {
  dom.window.localStorage.clear();
  dom.window.localStorage.setItem('stock11.watchlist.v1', JSON.stringify([item]));
  let state = emptyProfile(), signedIn = false, failWrites = false;
  const writes = [], ids = new Set();
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/session') {
      if (options.method === 'POST') signedIn = true;
      if (options.method === 'DELETE') signedIn = false;
      return Response.json({ enabled: true, authenticated: signedIn, location: 'Redis Cloud' });
    }
    if (!signedIn) return Response.json({ error: '로그인 필요' }, { status: 401 });
    if (options.method === 'PATCH') {
      const body = JSON.parse(options.body); writes.push(body);
      if (failWrites) throw new Error('offline');
      if (!ids.has(body.id)) { state = { ...applyOperation(state, body.operation), revision: state.revision + 1, updatedAt: new Date().toISOString() }; ids.add(body.id); }
    }
    return Response.json({ profile: state });
  };
  const hook = renderHook(useServerProfile);
  await waitFor(() => assert.equal(hook.result.current.phase, 'locked'));
  assert.equal(writes.length, 0);
  await act(async () => { await hook.result.current.login('only-sent-to-api'); });
  assert.equal(hook.result.current.phase, 'ready');
  assert.equal(writes.length, 0, 'local records must not automatically overwrite server state');
  act(() => hook.result.current.send({ type: 'import', watchlist: [item], highlights: [] }));
  await waitFor(() => assert.equal(hook.result.current.unsaved, false));
  act(() => {
    hook.result.current.send({ type: 'highlight', key: 'NASDAQ:QQQ.O', color: 'yellow' });
    hook.result.current.send({ type: 'highlight', key: 'NASDAQ:QQQ.O', color: 'red' });
  });
  await waitFor(() => assert.deepEqual(state.highlights, [['NASDAQ:QQQ.O', 'red']]));
  await waitFor(() => assert.equal(hook.result.current.unsaved, false));
  failWrites = true;
  act(() => hook.result.current.send({ type: 'settings', largeText: false }));
  await waitFor(() => assert.ok(hook.result.current.message));
  assert.equal(hook.result.current.unsaved, true);
  const failedId = writes.at(-1).id;
  const count = writes.length;
  await act(async () => { await hook.result.current.refresh(); });
  assert.equal(writes.length, count, 'stale/offline changes require explicit retry');
  failWrites = false;
  await act(async () => { await hook.result.current.retry(); });
  assert.equal(writes.at(-1).id, failedId);
  assert.equal(state.settings.largeText, false);
  assert.equal(JSON.parse(dom.window.localStorage.getItem(PROFILE_CACHE_KEY)).revision, state.revision);
  assert.equal(dom.window.localStorage.getItem(PROFILE_CACHE_KEY).includes('only-sent-to-api'), false);
  // Another computer writes newer server state; refresh reads it without PUT.
  state = { ...applyOperation(state, { type: 'remove', key: 'NASDAQ:QQQ.O' }), revision: state.revision + 1 };
  await act(async () => { await hook.result.current.refresh(); });
  assert.equal(hook.result.current.profile.watchlist.length, 0);
  await act(async () => { await hook.result.current.logout(); });
  assert.equal(hook.result.current.phase, 'locked');
  assert.equal(hook.result.current.profile.watchlist.length, 0);
  assert.equal(dom.window.localStorage.getItem(PROFILE_CACHE_KEY), null);
  hook.unmount();
});

void test('Redis outage shows the last confirmed cache read-only; missing configuration keeps local fallback', async () => {
  const saved = { ...emptyProfile(), revision: 2, watchlist: [item] };
  dom.window.localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(saved));
  globalThis.fetch = async () => { throw new Error('Redis unavailable'); };
  let hook = renderHook(useServerProfile);
  await waitFor(() => assert.equal(hook.result.current.phase, 'cached'));
  assert.equal(hook.result.current.profile.watchlist[0].code, 'QQQ');
  act(() => hook.result.current.send({ type: 'remove', key: 'NASDAQ:QQQ.O' }));
  assert.equal(hook.result.current.profile.watchlist.length, 1);
  hook.unmount();
  globalThis.fetch = async () => Response.json({ enabled: false, authenticated: false });
  hook = renderHook(useServerProfile);
  await waitFor(() => assert.equal(hook.result.current.phase, 'local'));
  assert.equal(hook.result.current.enabled, false);
  hook.unmount();
});
