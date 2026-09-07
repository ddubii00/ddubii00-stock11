import test from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../app/api/index-chart/route.ts';

test('header returns all five charts and keeps the last FX quote in each minute without filling gaps', async () => {
  const originalFetch = globalThis.fetch, requested = [];
  globalThis.fetch = async (url) => {
    requested.push(url);
    if (url.includes('FX_USDKRW')) return Response.json({ result: {
      tradeBaseAt: '20260908', localDateTimeNow: '20260908084100', lastClosePrice: 1347,
      priceInfos: [
        { localDateTime: '20260908082510', currentPrice: 1342.6 },
        { localDateTime: '20260908082547', currentPrice: 1343 },
        { localDateTime: '20260908083425', currentPrice: 1345.5 },
        { localDateTime: '20260908085000', currentPrice: 1400 },
        { localDateTime: '20260907090000', currentPrice: 1500 },
      ],
    } });
    const foreign = url.includes('/foreign/');
    return Response.json({ tradeBaseAt: '20260907', lastClosePrice: 100, localDateTimeNow: '20260907200000', priceInfos: [{ localDateTime: foreign ? '20260907093000' : '20260907090000', currentPrice: 101 }] });
  };
  try {
    const response = await GET(), { series } = await response.json();
    assert.deepEqual(Object.keys(series).sort(), ['KOSPI', 'KOSDAQ', 'NASDAQ', 'S&P 500', 'USD/KRW'].sort());
    assert.ok(requested.some((url) => url.includes('/.INX?')));
    assert.equal(series['S&P 500'].market, 'SP500');
    assert.deepEqual(series['USD/KRW'].points, [{ minute: 505, price: 1343 }, { minute: 514, price: 1345.5 }]);
    assert.equal(series['USD/KRW'].previousClose, 1347);
    assert.equal(series['USD/KRW'].session.timeZone, 'Asia/Seoul');
  } finally { globalThis.fetch = originalFetch; }
});
