import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSymbols, preserveSavedName, reorderWatchlist, restoreWatchlist, symbolKey } from '../lib/watchlist.ts';
import { makeChartModel } from '../lib/chart-model.ts';
import { stockUrl } from '../lib/stock-links.ts';

test('mixed market batches validate, deduplicate and preserve alphanumeric Korean codes', () => {
  assert.equal(parseSymbols('KOSPI:0126Z0,NASDAQ:AAPL.O,NYSE:IBM,AMEX:AA.K,SP500:IBM')?.length, 5);
  assert.equal(parseSymbols('KOSPI:005930,KOSPI:005930')?.length, 1);
  for (const invalid of ['', 'OTHER:IBM', 'KOSPI:../../etc', 'NYSE:IBM:extra', 'KOSPI:']) assert.equal(parseSymbols(invalid), null);
  assert.equal(parseSymbols(Array.from({ length: 33 }, (_, i) => `NYSE:S${i}`).join(',')), null);
});
test('watchlist persistence rejects corrupt entries and duplicates, and caps at 200', () => {
  const samsung = { market: 'KOSPI', name: '삼성전자', code: '005930', chartCode: '005930' };
  assert.deepEqual(restoreWatchlist('not JSON'), []);
  assert.deepEqual(restoreWatchlist('{}'), []);
  assert.deepEqual(restoreWatchlist(JSON.stringify([samsung, samsung, null, { ...samsung, market: 'invalid' }, { ...samsung, chartCode: '../bad' } ])), [samsung]);
  assert.equal(symbolKey(samsung), 'KOSPI:005930');
  assert.equal(restoreWatchlist(JSON.stringify(Array.from({ length: 250 }, (_, i) => ({ ...samsung, code: `S${i}`, chartCode: `S${i}` })))).length, 200);
});
test('KIS close updates preserve the saved stock name instead of replacing it with its code', () => {
  const saved = { market: 'KOSPI', name: 'SK하이닉스', code: '000660', chartCode: '000660' };
  assert.deepEqual(preserveSavedName(saved, { name: '000660', code: '000660', price: 1857000 }), { name: 'SK하이닉스', code: '000660', price: 1857000 });
});
test('NYSE, AMEX and S&P500 charts use US time and PC destinations', () => {
  for (const market of ['NYSE', 'AMEX', 'SP500']) {
    const model = makeChartModel({ market, code: 'IBM', date: '20260904', previousClose: 200, points: [{ minute: 570, price: 201 }, { minute: 960, price: 202 }], asOf: '' }, new Date('2026-09-04T16:00:00-04:00'));
    assert.equal(model.session.timeZone, 'America/New_York');
    assert.equal(model.last.minute, 960);
    assert.equal(stockUrl({ code: 'IBM', chartCode: 'IBM' }, market), 'https://stock.naver.com/worldstock/stock/IBM/total');
  }
});

test('watchlist reordering moves in both directions, preserves metadata, and survives persistence', () => {
  const items = [
    { market: 'KOSPI', code: '005930', chartCode: '005930', name: '삼성전자' },
    { market: 'NASDAQ', code: 'AAPL', chartCode: 'AAPL.O', name: '애플' },
    { market: 'KOSDAQ', code: '0126Z0', chartCode: '0126Z0', name: '테스트' },
  ];
  const moved = reorderWatchlist(items, symbolKey(items[0]), symbolKey(items[2]));
  assert.deepEqual(moved, [items[1], items[2], items[0]]);
  assert.equal(items[0].name, '삼성전자');
  assert.equal(moved[2], items[0]);
  assert.deepEqual(restoreWatchlist(JSON.stringify(moved)), moved);
  assert.deepEqual(reorderWatchlist(moved, symbolKey(items[0]), symbolKey(items[1])), items);
  assert.equal(reorderWatchlist(items, 'NYSE:missing', symbolKey(items[0])), items);
  assert.equal(reorderWatchlist(items, symbolKey(items[0]), 'NYSE:missing'), items);
  assert.equal(reorderWatchlist(items, symbolKey(items[0]), symbolKey(items[0])), items);
});
