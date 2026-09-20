import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNxtFinalClose } from '../server/kis-nxt-close.mjs';
import { domesticQuotePlan } from '../server/kis-domestic-routing.mjs';

void test('NXT history retains the last real after-market trade rather than a closed-session current price', () => {
  const parsed = parseNxtFinalClose({
    output1: { stck_prdy_clpr: '1745000' },
    output2: [
      { stck_bsop_date: '20260918', stck_cntg_hour: '170000', stck_prpr: '1835000' },
      { stck_bsop_date: '20260918', stck_cntg_hour: '195959', stck_prpr: '1849000', acml_vol: '123' },
      { stck_bsop_date: '20260918', stck_cntg_hour: '153000', stck_prpr: '1857000' },
    ],
  }, '000660', '20260918', 1745000, '2026-09-20T01:00:00.000Z');
  assert.equal(parsed?.quote.price, 1849000);
  assert.equal(parsed?.quote.priceSource, 'kis-nxt-close');
  assert.equal(parsed?.quote.priceSession, 'after');
  assert.equal(parsed?.quote.asOf, '2026-09-18T19:59:59+09:00');
});

void test('closed KRX2 routes to NX history while live 16:00-20:00 uses NX multi-price', () => {
  assert.deepEqual(domesticQuotePlan({ session: 'regular', open: true, minute: 1020 }), { source: 'daily-close', marketCode: 'J' });
  assert.deepEqual(domesticQuotePlan({ session: 'after', open: true, minute: 1020 }), { source: 'multi', marketCode: 'NX' });
  assert.deepEqual(domesticQuotePlan({ session: 'after', open: true, minute: 1230 }), { source: 'nxt-close', marketCode: 'NX' });
  assert.deepEqual(domesticQuotePlan({ session: 'after', open: false, minute: 660 }), { source: 'nxt-close', marketCode: 'NX' });
});
