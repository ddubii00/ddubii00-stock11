import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarketCalendar } from '../server/kis-market-calendar.mjs';

function calendar({ date, minute, open = true }) {
  let calls = 0;
  const value = createMarketCalendar({
    clock: () => ({ date, minute }),
    fetchHoliday: async (requestedDate) => { calls++; return { output: [{ bass_dt: requestedDate, opnd_yn: open ? 'Y' : 'N' }] }; },
  });
  return { value, calls: () => calls };
}

void test('KRX always remains regular while KRX2 selects J only during an open regular session', async () => {
  for (const sample of [
    { name: 'A trading day 10:00', date: '20260918', minute: 600, open: true, requestedAfter: false, expected: 'regular' },
    { name: 'B trading day 10:00 KRX2', date: '20260918', minute: 600, open: true, requestedAfter: true, expected: 'regular' },
    { name: 'C trading day 17:00 KRX2', date: '20260918', minute: 1020, open: true, requestedAfter: true, expected: 'after' },
    { name: 'D trading day 21:00 KRX2', date: '20260918', minute: 1260, open: true, requestedAfter: true, expected: 'after' },
    { name: 'E next day 08:00 KRX2', date: '20260921', minute: 480, open: true, requestedAfter: true, expected: 'after' },
    { name: 'F Saturday 11:00 KRX2', date: '20260919', minute: 660, open: false, requestedAfter: true, expected: 'after' },
    { name: 'G Sunday 11:00 KRX2', date: '20260920', minute: 660, open: false, requestedAfter: true, expected: 'after' },
    { name: 'H holiday 11:00 KRX2', date: '20261009', minute: 660, open: false, requestedAfter: true, expected: 'after' },
    { name: 'I KRX ignores time and weekday', date: '20260920', minute: 660, open: false, requestedAfter: false, expected: 'regular' },
  ]) {
    const { value } = calendar(sample);
    assert.equal(await value.sessionFor(sample.requestedAfter), sample.expected, sample.name);
  }
});

void test('KIS holiday calendar is fetched once per Korean date and publishes safe diagnostics', async () => {
  const { value, calls } = calendar({ date: '20260918', minute: 1020 });
  assert.equal(await value.sessionFor(true), 'after');
  assert.equal(await value.sessionFor(true), 'after');
  assert.equal(calls(), 1);
  assert.deepEqual(value.diagnostics(), { date: '20260918', open: true, source: 'kis-holiday' });
});
