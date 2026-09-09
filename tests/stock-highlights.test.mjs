import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { HIGHLIGHTS_KEY, restoreHighlights } from '../lib/stock-highlights.ts';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
for (const key of ['window', 'document', 'navigator']) Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { renderHook, act, cleanup } = await import('@testing-library/react');
const { renderToString } = await import('react-dom/server');
const { useStockHighlights } = await import('../hooks/use-stock-highlights.ts');
after(() => { cleanup(); dom.window.close(); });

test('saved highlights validate symbols and colors without affecting other preferences', () => {
  for (const invalid of [null, '', '{', '{}', 'true']) assert.equal(restoreHighlights(invalid).size, 0);
  assert.deepEqual([...restoreHighlights(JSON.stringify([
    ['KOSPI:005930', 'yellow'], ['NASDAQ:QQQ.O', 'red'], ['KOSDAQ:0126Z0', 'yellow'],
    ['KOSPI:005930', 'red'], ['BAD:A', 'red'], ['KOSPI:../bad', 'red'], ['NYSE:IBM', 'blue'], null, ['NYSE:IBM'],
  ]))], [['KOSPI:005930', 'red'], ['NASDAQ:QQQ.O', 'red'], ['KOSDAQ:0126Z0', 'yellow']]);
});

test('StrictMode restores without initial overwrite and saves colors/removals immediately across remounts', () => {
  const storage = dom.window.localStorage;
  storage.clear();
  storage.setItem(HIGHLIGHTS_KEY, JSON.stringify([['KOSPI:005930', 'yellow'], ['NASDAQ:QQQ.O', 'red']]));
  storage.setItem('stock11.watchlist.v1', 'unchanged');
  const original = dom.window.Storage.prototype.setItem;
  let writes = 0;
  dom.window.Storage.prototype.setItem = function (...args) { writes++; return original.apply(this, args); };
  try {
    const options = { wrapper: ({ children }) => React.createElement(React.StrictMode, null, children) };
    let hook = renderHook(useStockHighlights, options);
    assert.equal(hook.result.current.highlighted.get('KOSPI:005930'), 'yellow');
    assert.equal(hook.result.current.highlighted.get('NASDAQ:QQQ.O'), 'red');
    assert.equal(writes, 0);
    act(() => hook.result.current.onHighlight('KOSPI:005930', 'red'));
    assert.equal(restoreHighlights(storage.getItem(HIGHLIGHTS_KEY)).get('KOSPI:005930'), 'red');
    hook.unmount();
    hook = renderHook(useStockHighlights, options);
    assert.equal(hook.result.current.highlighted.get('KOSPI:005930'), 'red');
    act(() => hook.result.current.onHighlight('KOSPI:005930'));
    hook.unmount();
    hook = renderHook(useStockHighlights, options);
    assert.equal(hook.result.current.highlighted.has('KOSPI:005930'), false);
    assert.equal(hook.result.current.highlighted.get('NASDAQ:QQQ.O'), 'red');
    assert.equal(storage.getItem('stock11.watchlist.v1'), 'unchanged');
    hook.unmount();
  } finally { dom.window.Storage.prototype.setItem = original; cleanup(); }
});

test('other-tab updates and clear synchronize without echo writes or lost unrelated symbols', () => {
  const storage = dom.window.localStorage;
  storage.clear();
  const hook = renderHook(useStockHighlights);
  act(() => hook.result.current.onHighlight('KOSPI:005930', 'yellow'));
  storage.setItem(HIGHLIGHTS_KEY, JSON.stringify([['KOSPI:005930', 'yellow'], ['NASDAQ:QQQ.O', 'red']]));
  // This tab has not received the event yet; its next write must still merge.
  act(() => hook.result.current.onHighlight('KOSDAQ:0126Z0', 'red'));
  assert.equal(hook.result.current.highlighted.get('NASDAQ:QQQ.O'), 'red');
  storage.setItem(HIGHLIGHTS_KEY, JSON.stringify([['NASDAQ:QQQ.O', 'yellow']]));
  const original = dom.window.Storage.prototype.setItem;
  dom.window.Storage.prototype.setItem = () => { throw new Error('Unexpected echo write'); };
  try {
    act(() => { dom.window.dispatchEvent(new dom.window.StorageEvent('storage', { key: HIGHLIGHTS_KEY, storageArea: storage })); });
    assert.deepEqual([...hook.result.current.highlighted], [['NASDAQ:QQQ.O', 'yellow']]);
    assert.equal(hook.result.current.highlightStorageError, '');
    storage.clear();
    act(() => { dom.window.dispatchEvent(new dom.window.StorageEvent('storage', { key: null, storageArea: storage })); });
    assert.equal(hook.result.current.highlighted.size, 0);
  } finally { dom.window.Storage.prototype.setItem = original; hook.unmount(); }
});

test('blocked storage keeps interactions usable and reports that saving failed', () => {
  dom.window.localStorage.clear();
  const originalGet = dom.window.Storage.prototype.getItem, originalSet = dom.window.Storage.prototype.setItem;
  dom.window.Storage.prototype.getItem = () => { throw new Error('Denied'); };
  dom.window.Storage.prototype.setItem = () => { throw new Error('Quota'); };
  try {
    const hook = renderHook(useStockHighlights);
    assert.match(hook.result.current.highlightStorageError, /저장소 사용 불가/);
    act(() => hook.result.current.onHighlight('KOSPI:005930', 'yellow'));
    act(() => hook.result.current.onHighlight('NASDAQ:QQQ.O', 'red'));
    assert.equal(hook.result.current.highlighted.size, 2);
    assert.match(hook.result.current.highlightStorageError, /저장 실패/);
    hook.unmount();
    // The server render must not touch localStorage at all.
    function ServerFixture() { return React.createElement('span', null, useStockHighlights().highlighted.size); }
    assert.equal(renderToString(React.createElement(ServerFixture)), '<span>0</span>');
  } finally {
    dom.window.Storage.prototype.getItem = originalGet;
    dom.window.Storage.prototype.setItem = originalSet;
    cleanup();
  }
});
