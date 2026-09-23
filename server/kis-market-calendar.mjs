function weekdayOpen(date) {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(4, 6));
  const day = Number(date.slice(6, 8));
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday > 0 && weekday < 6;
}

function calendarRows(body) {
  if (Array.isArray(body?.output)) return body.output;
  if (body?.output && typeof body.output === 'object') return [body.output];
  return [];
}

// KIS explicitly asks that chk-holiday be called no more than roughly once a
// day. This module keeps that policy separate from the high-frequency quote
// cache and keeps a failed lookup from being retried by every browser refresh.
export function createMarketCalendar({ clock, fetchHoliday }) {
  const byDate = new Map();
  const pending = new Map();
  let last = {};

  async function isOpenTradingDay(date = clock().date) {
    const cached = byDate.get(date);
    if (cached) { last = cached; return cached.open; }
    if (pending.has(date)) return pending.get(date);
    const task = (async () => {
      let entry;
      try {
        const body = await fetchHoliday(date);
        const row = calendarRows(body).find((item) => String(item?.bass_dt ?? date) === date) ?? calendarRows(body)[0];
        if (!row || !['Y', 'N'].includes(String(row.opnd_yn))) throw new Error('KIS holiday response unavailable');
        entry = { date, open: row.opnd_yn === 'Y', source: 'kis-holiday' };
      } catch {
        // A transient calendar failure must not turn every weekday morning into
        // NXT. The exact KIS result is retried on the next server day.
        entry = { date, open: weekdayOpen(date), source: 'weekday-fallback' };
      }
      byDate.set(date, entry); last = entry;
      return entry.open;
    })();
    pending.set(date, task);
    try { return await task; } finally { pending.delete(date); }
  }

  async function sessionFor(requestedAfter) {
    if (!requestedAfter) return 'regular';
    const { minute } = clock();
    const open = await isOpenTradingDay();
    // Keep today's NXT premarket separate from yesterday's NXT final. Between
    // 15:30 and 16:00 KRX2 continues to show today's regular KRX close.
    if (open && minute >= 480 && minute < 540) return 'pre';
    return open && minute >= 540 && minute < 960 ? 'regular' : 'after';
  }

  return { isOpenTradingDay, sessionFor, diagnostics: () => ({ ...last }) };
}
