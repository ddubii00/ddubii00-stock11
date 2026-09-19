import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeKisQuotes } from '../lib/kis-relay.ts';

const naverRegular = { code: '000660', chartCode: '000660', name: 'SK하이닉스', price: 1857000, previousClose: 1800000, change: 3.17, changePrice: 57000, turnover: '—', asOf: '2026-09-18T15:30:00+09:00', market: 'KOSPI', marketStatus: 'CLOSE' };
const unified = { chartCode: '000660', price: 1849000, previousClose: 1800000, change: 2.72, changePrice: 49000, asOf: '2026-09-18T20:00:00+09:00', marketStatus: 'AFTER', priceSource: 'kis-rest', priceSession: 'after' };

test('KRX regular close cannot be replaced by a KRX/NXT unified price', () => {
  const [quote] = mergeKisQuotes([naverRegular], { '000660': unified }, false);
  assert.equal(quote.price, 1857000);
  assert.equal(quote.priceSession, 'regular');
  assert.equal(quote.priceSource, 'naver-fallback');
});

test('KRX2 uses an explicit integrated after-session KIS price', () => {
  const [quote] = mergeKisQuotes([naverRegular], { '000660': unified }, true);
  assert.equal(quote.price, 1849000);
  assert.equal(quote.priceSession, 'after');
  assert.equal(quote.priceSource, 'kis-rest');
});
