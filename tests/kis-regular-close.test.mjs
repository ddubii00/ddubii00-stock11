import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRegularDailyClose } from '../server/kis-daily-close.mjs';
import { domesticQuotePlan } from '../server/kis-domestic-routing.mjs';

const fridayClose = {
  output: [
    { stck_bsop_date: '20260918', stck_clpr: '1857000', prdy_vrss: '112000', prdy_vrss_sign: '2', prdy_ctrt: '6.42', acml_vol: '1234567' },
    { stck_bsop_date: '20260917', stck_clpr: '1745000' },
  ],
};

void test('KIS daily-price parser keeps the latest verified KRX close', () => {
  const parsed = parseRegularDailyClose(fridayClose, '000660', '2026-09-20T02:00:00.000Z');
  assert.deepEqual(parsed, {
    tradeDate: '20260918',
    quote: {
      chartCode: '000660', price: 1857000, previousClose: 1745000, changePrice: 112000, change: 6.42, volume: '1234567',
      asOf: '2026-09-18T15:30:00+09:00', fetchedAt: '2026-09-20T02:00:00.000Z', marketStatus: 'CLOSE', priceSource: 'kis-daily-close', priceSession: 'regular',
    },
  });
});

void test('plain KRX always uses the bulk J-market REST snapshot', () => {
  assert.deepEqual(domesticQuotePlan({ session: 'regular', open: true, minute: 600 }), { source: 'multi', marketCode: 'J' });
  assert.deepEqual(domesticQuotePlan({ session: 'regular', open: true, minute: 1020 }), { source: 'multi', marketCode: 'J' });
  assert.deepEqual(domesticQuotePlan({ session: 'regular', open: false, minute: 660 }), { source: 'multi', marketCode: 'J' });
});

void test('KRX2 keeps NX multi-price after 16:00, distinct from Sunday KRX daily close', () => {
  const krx = parseRegularDailyClose(fridayClose, '000660')?.quote;
  const krx2 = { price: 1849000, priceSession: 'after', priceSource: 'kis-multi-rest' };
  assert.deepEqual(domesticQuotePlan({ session: 'after', open: true, minute: 1020 }), { source: 'multi', marketCode: 'NX' });
  assert.equal(krx?.price, 1857000);
  assert.equal(krx2.price, 1849000);
  assert.notEqual(krx?.price, krx2.price);
});
