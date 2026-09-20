import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRegularHistoricalClose } from '../server/kis-regular-close.mjs';

void test('KRX historical J minute data preserves the actual 15:30 regular close and volume', () => {
  const parsed = parseRegularHistoricalClose({
    output1: { stck_prdy_clpr: '1745000', acml_vol: '4764077' },
    output2: [
      { stck_bsop_date: '20260918', stck_cntg_hour: '152959', stck_prpr: '1856000' },
      { stck_bsop_date: '20260918', stck_cntg_hour: '153000', stck_prpr: '1857000' },
      { stck_bsop_date: '20260918', stck_cntg_hour: '160000', stck_prpr: '1849000' },
    ],
  }, '000660', '20260918', '2026-09-20T01:00:00.000Z');

  assert.equal(parsed?.quote.price, 1857000);
  assert.equal(parsed?.quote.previousClose, 1745000);
  assert.equal(parsed?.quote.changePrice, 112000);
  assert.equal(parsed?.quote.volume, '4764077');
  assert.equal(parsed?.quote.priceSource, 'kis-regular-close');
  assert.equal(parsed?.quote.priceSession, 'regular');
  assert.equal(parsed?.quote.asOf, '2026-09-18T15:30:00+09:00');
});
