import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'CustomEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  Object.defineProperty(globalThis, key, { value: key === 'window' ? dom.window : typeof dom.window[key] === 'function' && ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(key) ? dom.window[key].bind(dom.window) : dom.window[key], configurable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
dom.window.ResizeObserver = globalThis.ResizeObserver;
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
const React = await import('react');
const { render, screen, cleanup, waitFor } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');
const { WatchlistToolbar } = await import('../components/watchlist-toolbar.tsx');
const { Sparkline, Candlestick } = await import('../components/stock-charts.tsx');
const { Board } = await import('../components/stock-dashboard.tsx');
const samsung = { market: 'KOSPI', code: '005930', chartCode: '005930', name: '삼성전자' };
const sdi = { market: 'KOSPI', code: '006400', chartCode: '006400', name: '삼성SDI' };
const apple = { market: 'NASDAQ', code: 'AAPL', chartCode: 'AAPL.O', name: '애플' };
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; cleanup(); dom.window.close(); });

test('Samsung substring search supports keyboard and mouse selection without duplicate chips or candle controls', async () => {
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(url);
    const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    return Response.json({ items: href.includes('AAPL') ? [apple] : [samsung, sdi] });
  };
  function Harness() {
    const [items, setItems] = React.useState([]);
    return React.createElement(WatchlistToolbar, { items, onChange: setItems, storageError: '' });
  }
  render(React.createElement(Harness));
  const user = userEvent.setup({ document: dom.window.document });
  const input = screen.getByRole('combobox', { name: '관심종목 검색' });
  await user.type(input, '삼성');
  await screen.findByRole('option', { name: /삼성전자/ });
  await user.keyboard('{ArrowDown}{Enter}');
  await screen.findByText('1/200');
  assert.equal(input.value, '');
  assert.ok(requests.some((url) => decodeURIComponent(url).includes('삼성')));
  await user.type(input, 'AAPL');
  await user.click(await screen.findByRole('option', { name: /애플/ }));
  assert.ok(screen.getByText('2/200'));
  await user.type(input, 'AAPL');
  await user.click(await screen.findByRole('option', { name: /애플/ }));
  assert.ok(screen.getByText('2/200'));
  assert.equal(screen.queryByRole('button', { name: '애플 관심종목 삭제' }), null);
  assert.equal(screen.queryByRole('button', { name: '일봉' }), null);
  cleanup();
});

test('small watchlists use normal row height, minute trends, and cell-local delete buttons outside links', async () => {
  const originalRect = dom.window.HTMLElement.prototype.getBoundingClientRect;
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 1600, height: 800, top: 0, left: 0, right: 1600, bottom: 800, x: 0, y: 0, toJSON() {} });
  const requests = [];
  globalThis.fetch = async (url) => { requests.push(url); return Response.json({ series: {}, errors: {} }); };
  const quotes = [samsung, apple].map((item) => ({ ...item, price: 100, previousClose: 99, change: 1, changePrice: 1, asOf: '2026-09-07T15:30:00+09:00', turnover: '', marketStatus: 'CLOSE' }));
  function Harness({ graph }) {
    const [stocks, setStocks] = React.useState(quotes);
    return React.createElement(Board, { market: 'KOSPI', graph, watch: true, payload: { stocks, indices: [], marketStatus: 'CLOSE', asOf: quotes[0].asOf, source: 'test' }, largeText: true, autoRefresh: false, now: Date.parse('2026-09-08T09:00:00+09:00'), provider: 'naver', onRemove: (quote) => setStocks((current) => current.filter((item) => item.code !== quote.code)) });
  }
  try {
    for (const graph of [false, true]) {
      const { container } = render(React.createElement(Harness, { graph }));
      const button = screen.getByRole('button', { name: '삼성전자 관심종목 삭제' });
      assert.equal(button.closest('a'), null);
      assert.ok(button.closest(graph ? '.graph-slot' : 'tr'));
      if (!graph) assert.ok(Number.parseFloat(button.closest('tr').style.height) <= 32);
      else {
        await waitFor(() => assert.ok(requests.some((url) => url.includes('kind=minutes'))));
        assert.ok(!requests.some((url) => url.includes('kind=candles')));
        assert.ok(!container.querySelector('.candle-area'));
      }
      await userEvent.setup({ document: dom.window.document }).click(button);
      assert.equal(screen.queryByRole('button', { name: '삼성전자 관심종목 삭제' }), null);
      assert.ok(screen.getByRole('button', { name: '애플 관심종목 삭제' }));
      cleanup();
    }
  } finally { dom.window.HTMLElement.prototype.getBoundingClientRect = originalRect; cleanup(); }
});

test('compact trend has a previous-close line and no axis labels; candles use actual OHLC', () => {
  const series = { market: 'KOSPI', code: '005930', date: '20260907', previousClose: 100, asOf: '', points: [{ minute: 540, price: 99 }, { minute: 660, price: 101 }, { minute: 930, price: 999 }] };
  const { container } = render(React.createElement(Sparkline, { series, name: '삼성전자', now: Date.parse('2026-09-07T11:00:00+09:00') }));
  assert.equal(container.querySelectorAll('text').length, 0);
  assert.equal(container.querySelectorAll('.spark-baseline').length, 1);
  assert.equal(container.querySelectorAll('path').length, 2);
  assert.ok(!container.querySelector('path').getAttribute('d').includes('177.00'));
  cleanup();
  const result = render(React.createElement(Candlestick, { name: '애플', previousClose: 100, series: { code: 'AAPL.O', interval: 'day', candles: [{ date: '20260904', open: 100, high: 105, low: 98, close: 103 }] } }));
  assert.equal(result.container.querySelectorAll('g rect').length, 1);
  assert.match(result.container.querySelector('g title').textContent, /시 100 · 고 105 · 저 98 · 종 103/);
  cleanup();
});
