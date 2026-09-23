import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNxtFinalClose, parseNxtPremarketClose, parseNxtPremarketMinutes } from '../server/kis-nxt-close.mjs';
import { domesticQuotePlan } from '../server/kis-domestic-routing.mjs';

void test('NXT history retains the last real after-market trade rather than a closed-session current price', () => {
  const parsed = parseNxtFinalClose({
    output1: { stck_prdy_clpr: '1745000', acml_vol: '987654' },
    output2: [
      { stck_bsop_date: '20260918', stck_cntg_hour: '170000', stck_prpr: '1835000' },
      { stck_bsop_date: '20260918', stck_cntg_hour: '195959', stck_prpr: '1849000', acml_vol: '123' },
      { stck_bsop_date: '20260918', stck_cntg_hour: '153000', stck_prpr: '1857000' },
    ],
  }, '000660', '20260918', 1745000, '2026-09-20T01:00:00.000Z');
  assert.equal(parsed?.quote.price, 1849000);
  assert.equal(parsed?.quote.priceSource, 'kis-nxt-close');
  assert.equal(parsed?.quote.priceSession, 'after');
  assert.equal(parsed?.quote.marketStatus, 'CLOSE');
  assert.equal(parsed?.quote.volume, '987654');
  assert.equal(parsed?.quote.asOf, '2026-09-18T19:59:59+09:00');
});

void test('closed KRX2 routes to NX history while live 16:00-20:00 uses NX multi-price', () => {
  assert.deepEqual(domesticQuotePlan({ session: 'regular', open: true, minute: 1020 }), { source: 'multi', marketCode: 'J' });
  assert.deepEqual(domesticQuotePlan({ session: 'after', open: true, minute: 1020 }), { source: 'multi', marketCode: 'NX' });
  assert.deepEqual(domesticQuotePlan({ session: 'after', open: true, minute: 1230 }), { source: 'nxt-close', marketCode: 'NX' });
  assert.deepEqual(domesticQuotePlan({ session: 'after', open: false, minute: 660 }), { source: 'nxt-close', marketCode: 'NX' });
});

void test('KRX2 uses live NX from 08:00 to 08:50 and today’s last premarket trade until 09:00', () => {
  assert.deepEqual(domesticQuotePlan({ session: 'pre', open: true, minute: 480 }), { source: 'multi', marketCode: 'NX' });
  assert.deepEqual(domesticQuotePlan({ session: 'pre', open: true, minute: 529 }), { source: 'multi', marketCode: 'NX' });
  assert.deepEqual(domesticQuotePlan({ session: 'pre', open: true, minute: 530 }), { source: 'nxt-pre-close', marketCode: 'NX' });
  assert.deepEqual(domesticQuotePlan({ session: 'regular', open: true, minute: 540 }), { source: 'multi', marketCode: 'J' });
  assert.deepEqual(domesticQuotePlan({ session: 'regular', open: true, minute: 959 }), { source: 'multi', marketCode: 'J' });
  const parsed = parseNxtPremarketClose({
    output1: { stck_prdy_clpr: '1745000' },
    output2: [
      { stck_bsop_date: '20260922', stck_cntg_hour: '195900', stck_prpr: '1800000' },
      { stck_bsop_date: '20260923', stck_cntg_hour: '080100', stck_prpr: '1810000' },
      { stck_bsop_date: '20260923', stck_cntg_hour: '084900', stck_prpr: '1819000' },
      { stck_bsop_date: '20260923', stck_cntg_hour: '090100', stck_prpr: '1820000' },
    ],
  }, '000660', '20260923', 1745000);
  assert.equal(parsed?.quote.price, 1819000);
  assert.equal(parsed?.quote.asOf, '2026-09-23T08:49:00+09:00');
  assert.equal(parsed?.quote.priceSource, 'kis-nxt-pre-close');
  assert.equal(parsed?.quote.priceSession, 'after');
  assert.equal(parsed?.quote.marketStatus, 'PRE');
});

void test('official NX minute rows fill only the 08:00-08:50 chart window with real prints', () => {
  const points = parseNxtPremarketMinutes({ output2: [
    { stck_bsop_date: '20260923', stck_cntg_hour: '080130', stck_prpr: '102' },
    { stck_bsop_date: '20260923', stck_cntg_hour: '080100', stck_prpr: '101' },
    { stck_bsop_date: '20260923', stck_cntg_hour: '084900', stck_prpr: '103' },
    { stck_bsop_date: '20260923', stck_cntg_hour: '090000', stck_prpr: '104' },
    { stck_bsop_date: '20260922', stck_cntg_hour: '080000', stck_prpr: '90' },
  ] }, '20260923');
  assert.deepEqual(points, [{ minute: 481, price: 102 }, { minute: 529, price: 103 }]);
});
