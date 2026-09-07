import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSymbols, restoreWatchlist, symbolKey } from '../lib/watchlist.ts';
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
test('NYSE, AMEX and S&P500 charts use US time and PC destinations', () => {
  for (const market of ['NYSE', 'AMEX', 'SP500']) {
    const model = makeChartModel({ market, code: 'IBM', date: '20260904', previousClose: 200, points: [{ minute: 570, price: 201 }, { minute: 960, price: 202 }], asOf: '' }, new Date('2026-09-04T16:00:00-04:00'));
    assert.equal(model.session.timeZone, 'America/New_York');
    assert.equal(model.last.minute, 960);
    assert.equal(stockUrl({ code: 'IBM', chartCode: 'IBM' }, market), 'https://stock.naver.com/worldstock/stock/IBM/total');
  }
});
