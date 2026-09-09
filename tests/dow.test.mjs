import test from 'node:test';
import assert from 'node:assert/strict';
import { readStocks } from '../lib/naver.ts';
import { sessionFor } from '../lib/chart-model.ts';
import { parseSymbols } from '../lib/watchlist.ts';

void test('Dow reads 30 real constituent quotes using their actual exchanges and US minute sessions', async () => {
  const original = globalThis.fetch, urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);
    return Response.json(Array.from({ length: 30 }, (_, i) => ({ stockEndType: 'stock', symbolCode: `D${i}`, reutersCode: `D${i}.O`, stockName: `Dow ${i}`, closePrice: '100', compareToPreviousClosePrice: '1', fluctuationsRatio: '1', marketStatus: 'CLOSE', localTradedAt: '2026-09-08T16:00:00-04:00', stockExchangeType: { name: i % 2 ? 'NYSE' : 'NASDAQ' } })));
  };
  try {
    const payload = await readStocks('DOW');
    assert.equal(payload.stocks.length, 30); assert.equal(urls.length, 1);
    assert.match(urls[0], /index\/\.DJI\/stocks/);
    assert.equal(payload.stocks[0].market, 'NASDAQ'); assert.equal(payload.stocks[1].market, 'NYSE');
    assert.equal(sessionFor('DOW').timeZone, 'America/New_York');
    assert.deepEqual(parseSymbols('DOW:IBM'), [{ market: 'DOW', chartCode: 'IBM' }]);
  } finally { globalThis.fetch = original; }
});
