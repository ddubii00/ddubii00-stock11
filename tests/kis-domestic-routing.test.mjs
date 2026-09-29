import test from 'node:test';
import assert from 'node:assert/strict';
import { domesticQuotePlan, mergeNxtWithRegular } from '../server/kis-domestic-routing.mjs';

void test('plain KRX always uses the bulk J-market REST snapshot', () => {
  for (const sample of [
    { open: true, minute: 600 },
    { open: true, minute: 931 },
    { open: true, minute: 932 },
    { open: true, minute: 960 },
    { open: false, minute: 600 },
    { open: false, minute: 1200 },
  ]) {
    assert.deepEqual(
      domesticQuotePlan({ session: 'regular', ...sample }),
      { source: 'multi', marketCode: 'J' },
    );
  }
});

void test('KRX2 keeps NXT prices and fills only non-NXT symbols from the 15:30 KRX close', () => {
  const nxt = { '000660': { price: 1849000, priceSession: 'after' } };
  const regular = {
    '000660': { price: 1857000, priceSession: 'regular' },
    '005935': { price: 194400, priceSession: 'regular' },
    '069500': { price: 48250, priceSession: 'regular' },
  };
  assert.deepEqual(
    mergeNxtWithRegular(['000660', '005935', '069500'], nxt, regular),
    {
      '000660': nxt['000660'],
      '005935': regular['005935'],
      '069500': regular['069500'],
    },
  );
});

void test('KRX2 preserves live NX bulk REST and closed NX historical final routing', () => {
  assert.deepEqual(
    domesticQuotePlan({ session: 'after', open: true, minute: 1000 }),
    { source: 'multi', marketCode: 'NX', fallback: 'regular-close' },
  );
  assert.deepEqual(
    domesticQuotePlan({ session: 'after', open: true, minute: 1201 }),
    { source: 'nxt-close', marketCode: 'NX', fallback: 'regular-close' },
  );
  assert.deepEqual(
    domesticQuotePlan({ session: 'after', open: false, minute: 1000 }),
    { source: 'nxt-close', marketCode: 'NX', fallback: 'regular-close' },
  );
});

void test('KRX2 always identifies the regular-close fallback for symbols without NXT trading', () => {
  for (const sample of [
    { session: 'pre', open: true, minute: 480, source: 'multi' },
    { session: 'pre', open: true, minute: 530, source: 'nxt-pre-close' },
    { session: 'after', open: true, minute: 960, source: 'multi' },
    { session: 'after', open: true, minute: 1200, source: 'nxt-close' },
    { session: 'after', open: false, minute: 600, source: 'nxt-close' },
  ]) {
    assert.deepEqual(domesticQuotePlan(sample), {
      source: sample.source,
      marketCode: 'NX',
      fallback: 'regular-close',
    });
  }
});
