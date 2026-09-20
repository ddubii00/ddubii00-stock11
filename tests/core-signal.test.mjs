import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeCoreSignal } from '../lib/core-signal.ts';

function makeHistory(lastClose, lastOpen, lastVolume) {
  const history = Array.from({ length: 180 }, (_, index) => {
    const price = 100 + index * 0.05;
    return { date: `2026${String((Math.floor(index / 28) % 12) + 1).padStart(2, '0')}${String((index % 28) + 1).padStart(2, '0')}`, open: price - 0.2, high: price + 1, low: price - 1, close: price, volume: 1000 };
  });
  if (lastClose !== undefined) Object.assign(history.at(-1), { open: lastOpen, high: Math.max(lastOpen, lastClose) + 1, low: Math.min(lastOpen, lastClose) - 1, close: lastClose, volume: lastVolume });
  return history;
}

test('stock1 bearish CORE fixture produces the same 90 percent sell recommendation', () => {
  const result = analyzeCoreSignal(makeHistory(80, 108, 3000));
  assert.equal(result.action, 'PARTIAL_SELL');
  assert.equal(result.percentage, 90);
});

test('stock1 bullish CORE fixture produces the same 95 percent buy recommendation', () => {
  const history = makeHistory();
  for (let index = 120; index < 180; index += 1) {
    const price = 115 - (index - 120) * 0.25;
    Object.assign(history[index], { open: price + 0.1, high: price + 1, low: price - 1, close: price });
  }
  Object.assign(history.at(-1), { open: 99, high: 122, low: 98, close: 121, volume: 4000 });
  const result = analyzeCoreSignal(history);
  assert.equal(result.action, 'PARTIAL_BUY');
  assert.equal(result.percentage, 95);
});
