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
const { render, screen, cleanup, waitFor, fireEvent } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');
const { WatchlistToolbar } = await import('../components/watchlist-toolbar.tsx');
const { Sparkline, Candlestick } = await import('../components/stock-charts.tsx');
const { Board } = await import('../components/stock-dashboard.tsx');
const { fitBoard } = await import('../lib/board-layout.ts');
const { reorderWatchlist } = await import('../lib/watchlist.ts');
const samsung = { market: 'KOSPI', code: '005930', chartCode: '005930', name: '삼성전자' };
const sdi = { market: 'KOSPI', code: '006400', chartCode: '006400', name: '삼성SDI' };
const apple = { market: 'NASDAQ', code: 'AAPL', chartCode: 'AAPL.O', name: '애플' };
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; cleanup(); dom.window.close(); });

test('middle-name Korean search, ETF ticker and numeric code remain selectable', async () => {
  const hynix = { market: 'KOSPI', code: '000660', chartCode: '000660', name: 'SK하이닉스' };
  const qqq = { market: 'NASDAQ', code: 'QQQ', chartCode: 'QQQ.O', name: 'Invesco QQQ Trust Series 1', instrumentType: 'etf' };
  const kodex = { market: 'KOSPI', code: '069500', chartCode: '069500', name: 'KODEX 200' };
  const cases = [['하이닉스', hynix], ['qqq', qqq], ['069500', kodex], ['Trust', qqq]];
  const added = [];
  globalThis.fetch = async (url) => {
    const q = new URL(url, 'http://localhost').searchParams.get('q');
    return Response.json({ items: cases.filter(([query]) => query === q).map(([, item]) => item) });
  };
  render(React.createElement(WatchlistToolbar, { items: [], onChange: (items) => added.push(items.at(-1)), storageError: '' }));
  const user = userEvent.setup({ document: dom.window.document });
  const input = screen.getByRole('combobox', { name: '관심종목 검색' });
  for (const [query, item] of cases) {
    await user.type(input, query);
    await screen.findByRole('option', { name: new RegExp(item.name) });
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => assert.equal(added.at(-1)?.chartCode, item.chartCode));
    assert.equal(input.value, '');
  }
  cleanup();
});

test('watchlist double-click and market single-click synchronize highlights both ways in quote and chart views', async () => {
  globalThis.fetch = async () => Response.json({ series: {}, errors: {} });
  const user = userEvent.setup({ document: dom.window.document });
  for (const market of ['KOSPI', 'KOSDAQ']) for (const graph of [false, true]) {
    const quote = { ...samsung, market, price: 100, previousClose: 99, change: 1, changePrice: 1, asOf: '2026-09-07T15:30:00+09:00', turnover: '', marketStatus: 'CLOSE' };
    function Harness() {
      const [highlighted, setHighlighted] = React.useState(new Map());
      const props = { market, graph, payload: { stocks: [quote], indices: [], marketStatus: 'CLOSE', asOf: quote.asOf, source: 'test' }, largeText: true, autoRefresh: false, now: 1788829200000, provider: 'naver', highlighted,
        onHighlight: (key, color) => setHighlighted((current) => { const next = new Map(current); if (color) next.set(key, color); else next.delete(key); return next; }) };
      return React.createElement(React.Fragment, null, React.createElement(Board, props), React.createElement(Board, { ...props, watch: true }));
    }
    render(React.createElement(Harness));
    const [normal, watch] = screen.getAllByRole('button', { name: '삼성전자 배경 표시' });
    const color = (button) => button.closest(graph ? '.graph-card' : 'tr').dataset.highlightColor;
    await user.click(watch);
    assert.equal(color(normal), 'yellow');
    assert.equal(color(watch), 'yellow');
    await user.dblClick(watch);
    assert.equal(color(normal), 'red');
    assert.equal(color(watch), 'red');
    assert.equal(normal.getAttribute('aria-pressed'), 'true');
    assert.equal(watch.getAttribute('aria-pressed'), 'true');
    await user.click(normal);
    assert.equal(watch.getAttribute('aria-pressed'), 'false');
    await user.click(normal);
    assert.equal(watch.getAttribute('aria-pressed'), 'true');
    await user.dblClick(watch);
    assert.equal(color(normal), 'red');
    await user.click(watch);
    assert.equal(normal.getAttribute('aria-pressed'), 'false');
    await user.dblClick(normal);
    assert.equal(color(watch), 'red');
    await user.click(normal);
    assert.equal(watch.getAttribute('aria-pressed'), 'false');
    cleanup();
  }
});

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
      assert.equal(container.querySelector('.kospi-chart-board'), null);
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

test('quote and chart backgrounds toggle highlights independently of name links, across price updates and views', async () => {
  globalThis.fetch = async () => Response.json({ series: {}, errors: {} });
  const user = userEvent.setup({ document: dom.window.document });
  for (const provider of ['naver', 'kis']) {
    const quote = { ...samsung, price: 99900, previousClose: 99000, change: .91, changePrice: 900, asOf: '2026-09-07T15:30:00+09:00', turnover: '', marketStatus: 'CLOSE' };
    const props = { market: 'KOSPI', graph: false, payload: { stocks: [quote], indices: [], marketStatus: 'CLOSE', asOf: quote.asOf, source: 'test' }, largeText: true, autoRefresh: false, now: Date.parse('2026-09-08T09:00:00+09:00'), provider };
    const view = render(React.createElement(Board, props));
    assert.equal(view.container.querySelector('.kospi-chart-board'), null);
    const toggle = () => screen.getByRole('button', { name: '삼성전자 배경 표시' });
    assert.equal(toggle().getAttribute('aria-pressed'), 'false');
    await user.click(view.container.querySelector('.current-price'));
    assert.equal(toggle().getAttribute('aria-pressed'), 'true');
    assert.equal(toggle().closest('tr').dataset.highlighted, 'true');
    const name = screen.getByRole('link', { name: '삼성전자' });
    assert.match(name.href, /finance\.naver\.com\/item\/main\.naver\?code=005930/);
    assert.equal(view.container.querySelectorAll('tbody a').length, 1);
    await user.click(name);
    assert.equal(toggle().getAttribute('aria-pressed'), 'true');
    const next = { ...props, payload: { ...props.payload, stocks: [{ ...quote, price: 100000, change: 10.12 }] } };
    view.rerender(React.createElement(Board, next));
    assert.equal(toggle().getAttribute('aria-pressed'), 'true');
    await user.click(view.container.querySelector('.change-rate'));
    assert.equal(toggle().getAttribute('aria-pressed'), 'false');
    toggle().focus();
    await user.keyboard(' ');
    assert.equal(toggle().getAttribute('aria-pressed'), 'true');
    view.rerender(React.createElement(Board, { ...next, graph: true }));
    assert.ok(view.container.querySelector('.kospi-chart-board'));
    assert.equal(toggle().getAttribute('aria-pressed'), 'true');
    assert.equal(view.container.querySelector('.graph-card').dataset.highlighted, 'true');
    assert.equal(view.container.querySelectorAll('.graph-card a').length, 1);
    await user.click(screen.getByRole('link', { name: '삼성전자 네이버 증권 새 탭에서 보기' }));
    assert.equal(toggle().getAttribute('aria-pressed'), 'true');
    await user.click(toggle());
    assert.equal(toggle().getAttribute('aria-pressed'), 'false');
    toggle().focus();
    await user.keyboard('{Enter}');
    assert.equal(toggle().getAttribute('aria-pressed'), 'true');
    cleanup();
  }
});

test('chart ranking runs down each column before moving right, including subsequent pages', async () => {
  const originalRect = dom.window.HTMLElement.prototype.getBoundingClientRect;
  globalThis.fetch = async () => Response.json({ series: {}, errors: {} });
  const user = userEvent.setup({ document: dom.window.document });
  try {
    for (const [width, height] of [[1600, 800], [810, 1090]]) {
      dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON() {} });
      const stocks = Array.from({ length: 200 }, (_, index) => ({ ...samsung, code: String(index).padStart(6, '0'), chartCode: String(index).padStart(6, '0'), name: `종목${index + 1}`, price: 100, previousClose: 99, change: 1, changePrice: 1, asOf: '2026-09-07T15:30:00+09:00', turnover: '', marketStatus: 'CLOSE' }));
      const { container } = render(React.createElement(Board, { market: 'KOSPI', graph: true, payload: { stocks, indices: [], marketStatus: 'CLOSE', asOf: stocks[0].asOf, source: 'test' }, largeText: true, autoRefresh: false, now: Date.parse('2026-09-08T10:00:00+09:00'), provider: 'naver' }));
      const layout = fitBoard(width, height, true, true, 200);
      for (const page of [0, 1]) {
        const slots = [...container.querySelectorAll('.graph-slot')];
        assert.equal(slots.length, layout.capacity);
        for (const [index, slot] of slots.entries()) {
          assert.equal(slot.style.gridColumn, String(Math.floor(index / layout.rows) + 1));
          assert.equal(slot.style.gridRow, String(index % layout.rows + 1));
          assert.equal(slot.querySelector('.graph-identity strong').textContent, `종목${page * layout.capacity + index + 1}`);
        }
        if (!page) await user.click(screen.getByRole('button', { name: '다음 종목' }));
      }
      cleanup();
    }
  } finally { dom.window.HTMLElement.prototype.getBoundingClientRect = originalRect; cleanup(); }
});

test('watchlist double-click highlights red and handle-only dragging reorders without deleting or navigating', async () => {
  const originalRect = dom.window.HTMLElement.prototype.getBoundingClientRect;
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 1600, height: 800, top: 0, left: 0, right: 1600, bottom: 800, x: 0, y: 0, toJSON() {} });
  globalThis.fetch = async () => Response.json({ series: {}, errors: {} });
  const quotes = [samsung, apple, sdi].map((item) => ({ ...item, price: 100, previousClose: 99, change: 1, changePrice: 1, asOf: '2026-09-07T15:30:00+09:00', turnover: '', marketStatus: 'CLOSE' }));
  const user = userEvent.setup({ document: dom.window.document });
  function Harness({ graph }) {
    const [stocks, setStocks] = React.useState(quotes);
    return React.createElement(Board, { market: 'KOSPI', graph, watch: true, payload: { stocks, indices: [], marketStatus: 'CLOSE', asOf: quotes[0].asOf, source: 'test' }, largeText: true, autoRefresh: false, now: Date.parse('2026-09-08T10:00:00+09:00'), provider: 'naver', onReorder: (from, to) => setStocks((current) => reorderWatchlist(current, from, to)), onRemove: (quote) => setStocks((current) => current.filter((item) => item.code !== quote.code)) });
  }
  try {
    for (const graph of [false, true]) {
      const { container } = render(React.createElement(Harness, { graph }));
      const toggle = () => screen.getByRole('button', { name: '삼성전자 배경 표시' });
      const handle = (name) => screen.getByRole('button', { name: `${name} 순서 이동` });
      const cell = (name) => handle(name).closest(graph ? '.graph-slot' : 'tr');
      const background = graph ? toggle() : cell('삼성전자').querySelector('.current-price');
      const color = () => toggle().closest(graph ? '.graph-card' : 'tr').dataset.highlightColor;
      assert.ok(container.querySelector('.watch-board'));
      await user.click(background);
      assert.equal(color(), 'yellow');
      await user.click(background);
      assert.equal(toggle().getAttribute('aria-pressed'), 'false');
      await user.dblClick(background);
      assert.equal(toggle().getAttribute('aria-pressed'), 'true');
      assert.equal(color(), 'red');
      await user.click(background);
      assert.equal(color(), undefined);
      await user.dblClick(background);
      assert.equal(color(), 'red');
      await user.dblClick(background);
      assert.equal(toggle().getAttribute('aria-pressed'), 'false');
      toggle().focus(); await user.keyboard(' ');
      assert.equal(toggle().getAttribute('aria-pressed'), 'true');
      assert.equal(color(), 'yellow');
      await user.dblClick(container.querySelector('a'));
      assert.equal(toggle().getAttribute('aria-pressed'), 'true');
      assert.equal(handle('삼성전자').closest('a'), null);
      assert.equal(handle('삼성전자').draggable, true);
      const order = () => [...container.querySelectorAll('[data-reorder-key]')].map((button) => button.dataset.reorderKey);
      const initial = order();
      const dataTransfer = { effectAllowed: '', dropEffect: '', setData() {}, setDragImage() {} };
      // An unrelated external drag cannot reorder the watchlist.
      fireEvent.drop(cell('애플'), { dataTransfer });
      assert.deepEqual(order(), initial);
      fireEvent.dragStart(handle('삼성전자'), { dataTransfer });
      assert.equal(dataTransfer.effectAllowed, 'move');
      fireEvent.dragOver(cell('삼성SDI'), { dataTransfer });
      assert.equal(cell('삼성SDI').dataset.dropTarget, 'true');
      fireEvent.drop(cell('삼성SDI'), { dataTransfer });
      fireEvent.dragEnd(handle('삼성전자'), { dataTransfer });
      assert.deepEqual(order(), ['NASDAQ:AAPL.O', 'KOSPI:006400', 'KOSPI:005930']);
      assert.equal(toggle().getAttribute('aria-pressed'), 'true');
      assert.equal(color(), 'yellow');
      assert.match(screen.getByRole('status').textContent, /삼성전자 3번째/);
      handle('삼성전자').focus(); await user.keyboard('{Home}');
      assert.deepEqual(order(), initial);
      // Cancelling a drag leaves the order unchanged and clears the destination.
      fireEvent.dragStart(handle('삼성전자'), { dataTransfer });
      fireEvent.dragOver(cell('애플'), { dataTransfer });
      fireEvent.dragEnd(handle('삼성전자'), { dataTransfer });
      assert.equal(cell('애플').dataset.dropTarget, 'false');
      assert.deepEqual(order(), initial);
      await user.click(screen.getByRole('button', { name: '삼성전자 관심종목 삭제' }));
      assert.equal(screen.queryByRole('button', { name: '삼성전자 순서 이동' }), null);
      assert.equal(order().length, 2);
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
