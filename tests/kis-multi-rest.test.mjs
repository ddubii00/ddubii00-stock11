import test from 'node:test';
import assert from 'node:assert/strict';
import { MULTI_BATCH_SIZE, canonicalCodes, multiBatches, multiCacheKey } from '../server/kis-multi.mjs';

const codes = (count) => Array.from({ length: count }, (_, index) => String(index + 1).padStart(6, '0'));

void test('KIS multi REST batches 34/60/31 symbols in official 30-code parameter pairs', () => {
  for (const [count, expected] of [[34, [30, 4]], [60, [30, 30]], [31, [30, 1]]]) {
    const batches = multiBatches(codes(count), 'J');
    assert.deepEqual(batches.map((batch) => batch.codes.length), expected);
    for (const batch of batches) {
      assert.ok(batch.codes.length <= MULTI_BATCH_SIZE);
      for (const [index, code] of batch.codes.entries()) {
        assert.equal(batch.params[`FID_COND_MRKT_DIV_CODE_${index + 1}`], 'J');
        assert.equal(batch.params[`FID_INPUT_ISCD_${index + 1}`], code);
      }
    }
  }
});

void test('KIS multi REST cache keys deduplicate concurrent browsers with reordered symbols', () => {
  const original = ['005930', '000660', '005380'];
  assert.deepEqual(canonicalCodes([...original, '005930']), ['000660', '005380', '005930']);
  assert.equal(multiCacheKey('KOSPI', 'regular', original), multiCacheKey('KOSPI', 'regular', [...original].reverse()));
  assert.notEqual(multiCacheKey('KOSPI', 'regular', original), multiCacheKey('KOSPI', 'after', original));
});
