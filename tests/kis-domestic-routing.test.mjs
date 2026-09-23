import test from 'node:test';
import assert from 'node:assert/strict';
import { domesticQuotePlan } from '../server/kis-domestic-routing.mjs';

void test('plain KRX always uses the bulk J-market REST snapshot', () => {
  for (const sample of [
    { open: true, minute: 600 },
    { open: true, minute: 931 },
    { open: false, minute: 600 },
    { open: false, minute: 1200 },
  ]) {
    assert.deepEqual(
      domesticQuotePlan({ session: 'regular', ...sample }),
      { source: 'multi', marketCode: 'J' },
    );
  }
});

void test('KRX2 preserves live NX bulk REST and closed NX historical final routing', () => {
  assert.deepEqual(
    domesticQuotePlan({ session: 'after', open: true, minute: 1000 }),
    { source: 'multi', marketCode: 'NX' },
  );
  assert.deepEqual(
    domesticQuotePlan({ session: 'after', open: true, minute: 1201 }),
    { source: 'nxt-close', marketCode: 'NX' },
  );
  assert.deepEqual(
    domesticQuotePlan({ session: 'after', open: false, minute: 1000 }),
    { source: 'nxt-close', marketCode: 'NX' },
  );
});
