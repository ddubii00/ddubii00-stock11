import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeKisQuotes } from '../lib/kis-relay.ts';

const naverRegular = { code: '000660', chartCode: '000660', name: 'SK하이닉스', price: 1857000, previousClose: 1745000, change: 6.42, changePrice: 112000, turnover: '—', asOf: '2026-09-18T15:30:00+09:00', market: 'KOSPI', marketStatus: 'CLOSE' };
const unified = { chartCode: '000660', price: 1849000, previousClose: 1745000, change: 5.96, changePrice: 104000, asOf: '2026-09-18T20:00:00+09:00', marketStatus: 'AFTER', priceSource: 'kis-rest', priceSession: 'after' };
const regularLive = { chartCode: '000660', price: 1857000, previousClose: 1745000, change: 6.42, changePrice: 112000, asOf: '2026-09-18T15:30:00+09:00', marketStatus: 'OPEN', priceSource: 'kis-live', priceSession: 'regular' };

void test('KRX regular close cannot be replaced by a KRX/NXT unified price', () => {
  const [quote] = mergeKisQuotes([naverRegular], { '000660': unified }, false);
  assert.equal(quote.price, 1857000);
  assert.equal(quote.priceSession, 'regular');
  assert.equal(quote.priceSource, 'naver-fallback');
});

void test('KRX2 uses an explicit integrated after-session KIS price', () => {
  const [quote] = mergeKisQuotes([naverRegular], { '000660': unified }, true);
  assert.equal(quote.price, 1849000);
  assert.equal(quote.priceSession, 'after');
  assert.equal(quote.priceSource, 'kis-rest');
  assert.equal(quote.previousClose, 1745000);
});

void test('SK hynix keeps distinct 2026-09-18 KRX and NXT finals on the 2026-09-20 weekend', () => {
  const [krx] = mergeKisQuotes([naverRegular], { '000660': unified }, false);
  const [krx2] = mergeKisQuotes([naverRegular], { '000660': unified }, true);
  assert.equal(krx.price, 1857000);
  assert.equal(krx2.price, 1849000);
  assert.notEqual(krx.price, krx2.price);
  assert.equal(krx.priceSession, 'regular');
  assert.equal(krx2.priceSession, 'after');
});

void test('KRX2 keeps KRX live data during the regular session before integrated trading begins', () => {
  const [quote] = mergeKisQuotes([naverRegular], { '000660': regularLive }, true);
  assert.equal(quote.price, 1857000);
  assert.equal(quote.priceSession, 'regular');
  assert.equal(quote.priceSource, 'kis-live');
});

void test('a partial KIS batch keeps only its missing symbol on the Naver fallback', () => {
  const naverSecond = { ...naverRegular, chartCode: '005930', code: '005930', name: '삼성전자', price: 70000 };
  const [first, second] = mergeKisQuotes([naverRegular, naverSecond], { '000660': unified }, true);
  assert.equal(first.priceSource, 'kis-rest');
  assert.equal(second.priceSource, 'naver-fallback');
  assert.equal(second.price, 70000);
});
