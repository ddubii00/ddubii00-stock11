import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { searchStocks, readQuote, readMinutes, readStocks } from '../lib/naver.ts';
import { restoreWatchlist } from '../lib/watchlist.ts';
import { stockUrl } from '../lib/stock-links.ts';
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });

test('search retains middle-name matches and Korean/US ETFs while excluding other markets', async () => {
  const entries = [
    { code: '000660', reutersCode: '000660', name: 'SK하이닉스', typeCode: 'KOSPI', nationCode: 'KOR', category: 'stock', url: '/domestic/stock/000660/total' },
    { code: '069500', reutersCode: '069500', name: 'KODEX 200', typeCode: 'KOSPI', nationCode: 'KOR', category: 'stock', url: '/domestic/stock/069500/total' },
    { code: 'QQQ', reutersCode: 'QQQ.O', name: 'Invesco QQQ Trust Series 1', typeCode: 'NASDAQ', nationCode: 'USA', category: 'stock', url: '/worldstock/etf/QQQ.O' },
    { code: 'BAD', reutersCode: 'BAD', name: 'Other market', typeCode: 'TOKYO', nationCode: 'JPN', category: 'stock', url: '/stock/BAD' },
  ];
  globalThis.fetch = async () => Response.json({ items: entries });
  const result = await searchStocks('  하이닉스  ');
  assert.deepEqual(result.map((item) => item.code), ['000660', '069500', 'QQQ']);
  assert.equal(result[2].instrumentType, 'etf');
  assert.deepEqual(restoreWatchlist(JSON.stringify(result)), result);
  assert.equal(stockUrl(result[2], 'NASDAQ'), 'https://stock.naver.com/worldstock/etf/QQQ.O');
});

test('Korean and US ETF quotes and minute series work through the common provider endpoints', async () => {
  for (const [market, code, name] of [['KOSPI', '069500', 'KODEX 200'], ['NASDAQ', 'QQQ.O', 'Invesco QQQ Trust']]) {
    globalThis.fetch = async (url) => Response.json((typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).includes('/chart/') ? {
      tradeBaseAt: '20260908', lastClosePrice: 100, localDateTimeNow: '20260908100000',
      priceInfos: [{ localDateTime: '20260908093000', currentPrice: 101 }, { localDateTime: '20260908100100', currentPrice: 102 }],
    } : { stockEndType: 'etf', reutersCode: code, stockName: name, closePrice: '101', compareToPreviousClosePrice: '1', fluctuationsRatio: '1', marketStatus: 'OPEN', localTradedAt: '2026-09-08T10:00:00', stockExchangeType: { name: market } });
    const quote = await readQuote(market, code);
    assert.equal(quote.instrumentType, 'etf');
    assert.equal(quote.price, 101);
    assert.equal(quote.name, name);
    const series = await readMinutes(market, code);
    assert.deepEqual(series.points, [{ minute: 570, price: 101 }]);
  }
});

test('domestic watchlist quotes fill missing volume from the realtime endpoint', async () => {
  globalThis.fetch = async (url) => Response.json(typeof url === 'string' && url.includes('polling.finance.naver.com') ? {
    datas: [{ accumulatedTradingVolume: '1,234,567' }],
  } : {
    stockEndType: 'stock', itemCode: '000660', reutersCode: '000660', stockName: 'SK하이닉스', closePrice: '100',
    compareToPreviousClosePrice: '1', fluctuationsRatio: '1', marketStatus: 'OPEN', localTradedAt: '2026-09-08T10:00:00',
    stockExchangeType: { name: 'KOSPI' },
  });
  const quote = await readQuote('KOSPI', '000660');
  assert.equal(quote.volume, '1,234,567');
});

test('foreign watchlist quotes replace apostrophe volume placeholders with numeric bars', async () => {
  globalThis.fetch = async (url) => Response.json(typeof url === 'string' && url.includes('/chart/foreign/item/') ? {
    priceInfos: [{ accumulatedTradingVolume: 9876543 }],
  } : {
    stockEndType: 'stock', reutersCode: 'AAPL.O', stockName: 'Apple', closePrice: '200',
    compareToPreviousClosePrice: '2', fluctuationsRatio: '1', accumulatedTradingVolume: "'", marketStatus: 'OPEN',
    localTradedAt: '2026-09-08T10:00:00', stockExchangeType: { name: 'NASDAQ' },
  });
  const quote = await readQuote('NASDAQ', 'AAPL.O');
  assert.equal(quote.volume, '9,876,543');
});

test('KRX2 uses Naver after-market quote fields while KRX keeps the regular close', async () => {
  globalThis.fetch = async (url) => Response.json(String(url).includes('polling.finance.naver.com') ? {
    result: { areas: [{ datas: [{ cd: '000660', nxtOverMarketPriceInfo: {
      overPrice: '103', compareToPreviousClosePrice: '4', fluctuationsRatio: '4', overMarketStatus: 'OPEN',
      localTradedAt: '2026-09-08T18:00:00+09:00', accumulatedTradingVolume: '765432', compareToPreviousPrice: { code: '2', name: '상승' },
    } }] }] },
  } : { stocks: [{
    stockEndType: 'stock', itemCode: '000660', reutersCode: '000660', stockName: 'SK하이닉스', closePrice: '100',
    compareToPreviousClosePrice: '1', fluctuationsRatio: '1', marketStatus: 'CLOSE', localTradedAt: '2026-09-08T15:30:00+09:00',
    stockExchangeType: { name: 'KOSPI' }, overMarketPriceInfo: {
      overPrice: '102', compareToPreviousClosePrice: '3', fluctuationsRatio: '3', overMarketStatus: 'OPEN',
      localTradedAt: '2026-09-08T17:00:00+09:00', accumulatedTradingVolume: '654321', compareToPreviousPrice: { code: '2', name: '상승' },
    },
  }] });
  const regular = await readStocks('KOSPI');
  const after = await readStocks('KOSPI', true);
  assert.equal(regular.stocks[0].price, 100);
  assert.equal(after.stocks[0].price, 103);
  assert.equal(after.stocks[0].change, 4);
  assert.equal(after.stocks[0].marketStatus, 'AFTER');
  assert.equal(after.stocks[0].volume, '765,432');
  assert.match(after.source, /장후 포함/);
});
