import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTrades, subscription } from '../server/kis-protocol.mjs';
import { stockUrl } from '../lib/stock-links.ts';

const domestic = (time = '110000', sign = '2') => {
  const row = Array(46).fill('0');
  Object.assign(row, { 0: '005930', 1: time, 2: '10100', 3: sign, 4: '100', 5: '1', 33: '20260907' });
  return row;
};
test('KIS supports alphanumeric Korean symbols and NASDAQ subscriptions only', () => {
  assert.equal(subscription('KOSPI', '0126Z0').key, '0126Z0');
  assert.equal(subscription('NASDAQ', 'NVDA.O').key, 'DNASNVDA');
  assert.equal(subscription('KOSPI', '../../key'), null);
  assert.equal(subscription('NASDAQ', 'IBM.N'), null);
});
test('KIS domestic ticks preserve price, previous close, date and decline signs', () => {
  const [tick] = parseTrades(`0|H0STCNT0|001|${domestic('110000', '5').join('^')}`);
  assert.equal(tick.price, 10100);
  assert.equal(tick.change, -1);
  assert.equal(tick.changePrice, -100);
  assert.equal(tick.previousClose, 10200);
  assert.equal(tick.minute, 660);
  assert.equal(tick.asOf, '2026-09-07T11:00:00+09:00');
});
test('KIS rejects after-hours, malformed, encrypted and account-notice messages', () => {
  for (const time of ['085959', '153001', '160000']) assert.equal(parseTrades(`0|H0STCNT0|001|${domestic(time).join('^')}`).length, 0);
  for (const value of ['0|H0STCNT0|001|bad', '1|H0STCNI0|001|encrypted', '{}']) assert.deepEqual(parseTrades(value), []);
});
test('KIS multi-record frames are decoded individually', () => {
  const ticks = parseTrades(`0|H0STCNT0|002|${[...domestic(), ...domestic('110001')].join('^')}`);
  assert.equal(ticks.length, 2);
  assert.equal(ticks[1].asOf, '2026-09-07T11:00:01+09:00');
});
test('NASDAQ ticks use exchange-local session and Korean absolute timestamp', () => {
  const row = Array(26).fill('0');
  Object.assign(row, { 0: 'DNASNVDA', 1: 'NVDA', 4: '20260904', 5: '110000', 6: '20260905', 7: '000000', 11: '230.36', 12: '2', 13: '1.91', 14: '0.84' });
  const [tick] = parseTrades(`0|HDFSCNT0|001|${row.join('^')}`);
  assert.equal(tick.subscriptionId, 'HDFSCNT0:DNASNVDA');
  assert.equal(tick.minute, 660);
  assert.equal(tick.date, '20260904');
  assert.equal(tick.asOf, '2026-09-05T00:00:00+09:00');
});
test('stock destinations are PC pages, not mobile pages', () => {
  assert.equal(stockUrl({ code: '066570', chartCode: '066570' }, 'KOSPI'), 'https://finance.naver.com/item/main.naver?code=066570');
  assert.equal(stockUrl({ code: '0126Z0', chartCode: '0126Z0' }, 'KOSDAQ'), 'https://finance.naver.com/item/main.naver?code=0126Z0');
  assert.equal(stockUrl({ code: 'NVDA', chartCode: 'NVDA.O' }, 'NASDAQ'), 'https://stock.naver.com/worldstock/stock/NVDA.O/total');
});
