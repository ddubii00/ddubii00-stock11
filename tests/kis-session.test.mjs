import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeKisQuotes } from '../lib/kis-relay.ts';

const metadata = {
  code: '000660',
  chartCode: '000660',
  name: 'SK하이닉스',
  price: 1857000,
  previousClose: 1745000,
  change: 6.42,
  changePrice: 112000,
  turnover: '123억원',
  volume: '999',
  asOf: '2026-09-18T15:30:00+09:00',
  market: 'KOSPI',
  marketStatus: 'CLOSE',
};

const unified = {
  chartCode: '000660',
  price: 1849000,
  previousClose: 1745000,
  change: 5.96,
  changePrice: 104000,
  volume: '1000',
  asOf: '2026-09-18T20:00:00+09:00',
  marketStatus: 'AFTER',
  priceSource: 'kis-rest',
  priceSession: 'after',
};

const regular = {
  chartCode: '000660',
  price: 1857000,
  previousClose: 1745000,
  change: 6.42,
  changePrice: 112000,
  volume: '1001',
  asOf: '2026-09-18T15:30:00+09:00',
  marketStatus: 'CLOSE',
  priceSource: 'kis-regular-close',
  priceSession: 'regular',
};

void test('KRX never falls back to a non-KIS stock price', () => {
  const [quote] = mergeKisQuotes([metadata], {}, false);
  assert.equal(quote.pending, true);
  assert.equal(quote.price, 0);
  assert.equal(quote.priceSource, undefined);
  assert.equal(quote.turnover, '—');
  assert.equal(quote.volume, '—');
});

void test('KRX regular view rejects an after-session quote instead of showing fallback data', () => {
  const [quote] = mergeKisQuotes([metadata], { '000660': unified }, false);
  assert.equal(quote.pending, true);
  assert.equal(quote.price, 0);
  assert.equal(quote.priceSession, 'regular');
});

void test('KRX regular view accepts the verified KIS 15:30 close', () => {
  const [quote] = mergeKisQuotes([metadata], { '000660': regular }, false);
  assert.equal(quote.pending, false);
  assert.equal(quote.price, 1857000);
  assert.equal(quote.priceSource, 'kis-regular-close');
  assert.equal(quote.priceSession, 'regular');
  assert.equal(quote.volume, '1001');
  assert.equal(quote.turnover, '—');
});

void test('KRX2 accepts an explicit KIS after-session quote', () => {
  const [quote] = mergeKisQuotes([metadata], { '000660': unified }, true);
  assert.equal(quote.pending, false);
  assert.equal(quote.price, 1849000);
  assert.equal(quote.priceSource, 'kis-rest');
  assert.equal(quote.priceSession, 'after');
});

void test('a partial KIS batch marks only its missing symbol pending', () => {
  const second = { ...metadata, chartCode: '005930', code: '005930', name: '삼성전자', price: 70000 };
  const [first, missing] = mergeKisQuotes([metadata, second], { '000660': regular }, false);
  assert.equal(first.pending, false);
  assert.equal(first.price, 1857000);
  assert.equal(missing.pending, true);
  assert.equal(missing.price, 0);
});
