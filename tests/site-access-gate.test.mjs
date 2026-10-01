import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<html><body></body></html>', { url: 'https://stock.example' });
for (const key of ['window', 'document', 'navigator']) Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act, cleanup, render, screen, waitFor } = await import('@testing-library/react');
const { SiteAccessGate } = await import('../components/site-access-gate.tsx');
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; cleanup(); dom.window.close(); });

void test('a transient session timeout never replaces an already authenticated dashboard', async () => {
  globalThis.fetch = async () => Response.json({ enabled: true, authenticated: true });
  render(React.createElement(SiteAccessGate, null, React.createElement('div', null, '대시보드 유지')));
  await screen.findByText('대시보드 유지');

  globalThis.fetch = async () => { throw new DOMException('signal timed out', 'TimeoutError'); };
  act(() => dom.window.dispatchEvent(new dom.window.Event('focus')));
  await waitFor(() => assert.ok(screen.getByText('대시보드 유지')));
  assert.equal(screen.queryByText(/signal timed out/i), null);
});
