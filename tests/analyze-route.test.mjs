import assert from 'node:assert/strict';
import test from 'node:test';
import { GET } from '../app/api/analyze/route.ts';

void test('daily signal route accepts every saved watchlist item up to the 200-item limit', async () => {
  const symbols = Array.from({ length: 200 }, (_, index) => `DOW:TAG${index}`).join(',');
  const response = await GET(new Request(`http://stock11.test/api/analyze?symbols=${encodeURIComponent(symbols)}`));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(Object.keys(body.errors).length, 200);

  const tooMany = `${symbols},DOW:OVER200`;
  const rejected = await GET(new Request(`http://stock11.test/api/analyze?symbols=${encodeURIComponent(tooMany)}`));
  assert.equal(rejected.status, 400);
});

void test('daily signal route calculates tags for US stocks and ETFs', async () => {
  const originalFetch = globalThis.fetch;
  const priceInfos = Array.from({ length: 180 }, (_, index) => {
    const closePrice = 100 + index * 0.1;
    return { localDate: String(20250101 + index), openPrice: closePrice - 0.2, highPrice: closePrice + 1, lowPrice: closePrice - 1, closePrice, accumulatedTradingVolume: 1_000_000 + index };
  });
  globalThis.fetch = async (url) => {
    const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    assert.match(href, /\/chart\/foreign\/item\/USTEST\.O\?periodType=month&range=24$/);
    return Response.json({ priceInfos });
  };
  try {
    const response = await GET(new Request('http://stock11.test/api/analyze?symbols=NASDAQ%3AUSTEST.O'));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.ok(body.signals['NASDAQ:USTEST.O']);
    assert.equal(body.errors['NASDAQ:USTEST.O'], undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
