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

void test('KRX2 selects the current NXT premarket, then KRX, then NXT after-market', async () => {
  for (const sample of [
    { name: 'A trading day 10:00', date: '20260918', minute: 600, open: true, requestedAfter: false, expected: 'regular' },
    { name: 'before 08:00 retains the preceding NXT final', date: '20260918', minute: 479, open: true, requestedAfter: true, expected: 'after' },
    { name: '08:00 opens NXT premarket', date: '20260918', minute: 480, open: true, requestedAfter: true, expected: 'pre' },
    { name: '08:49 NXT premarket', date: '20260918', minute: 529, open: true, requestedAfter: true, expected: 'pre' },
    { name: '08:50 keeps the morning NX final', date: '20260918', minute: 530, open: true, requestedAfter: true, expected: 'pre' },
    { name: '08:59 keeps the morning NX final', date: '20260918', minute: 539, open: true, requestedAfter: true, expected: 'pre' },
    { name: 'B trading day 10:00 KRX2', date: '20260918', minute: 600, open: true, requestedAfter: true, expected: 'regular' },
    { name: '15:30 keeps KRX close until NXT opens', date: '20260918', minute: 930, open: true, requestedAfter: true, expected: 'regular' },
    { name: '15:59 keeps KRX close until NXT opens', date: '20260918', minute: 959, open: true, requestedAfter: true, expected: 'regular' },
    { name: 'C trading day 17:00 KRX2', date: '20260918', minute: 1020, open: true, requestedAfter: true, expected: 'after' },
    { name: 'D trading day 21:00 KRX2', date: '20260918', minute: 1260, open: true, requestedAfter: true, expected: 'after' },
    { name: 'E next trading day 08:00 KRX2', date: '20260921', minute: 480, open: true, requestedAfter: true, expected: 'pre' },
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
