function number(value) { const text = String(value ?? '').replaceAll(',', '').trim(); return text ? Number(text) : Number.NaN; }

function output1(body) {
  if (Array.isArray(body?.output1)) return body.output1[0] ?? {};
  return body?.output1 && typeof body.output1 === 'object' ? body.output1 : {};
}

function output2(body) { return Array.isArray(body?.output2) ? body.output2 : []; }

function nxtAsOf(date, hour) {
  if (!/^\d{8}$/.test(date) || !/^\d{6}$/.test(hour)) return '';
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${hour.slice(0, 2)}:${hour.slice(2, 4)}:${hour.slice(4, 6)}+09:00`;
}

// The NX current-price response is only used during the live 16:00–20:00
// session. Closed sessions recover the last real NX historical trade instead.
export function parseNxtFinalClose(body, code, tradeDate, previousCloseFallback, fetchedAt = new Date().toISOString()) {
  const rows = output2(body)
    .map((row) => ({ row, date: String(row?.stck_bsop_date ?? ''), hour: String(row?.stck_cntg_hour ?? '').padStart(6, '0'), price: number(row?.stck_prpr) }))
    .filter(({ date, hour, price }) => date === tradeDate && /^\d{6}$/.test(hour) && hour >= '160000' && hour <= '200000' && Number.isFinite(price) && price > 0)
    .sort((left, right) => right.hour.localeCompare(left.hour));
  const latest = rows[0];
  if (!latest) return undefined;
  const summary = output1(body);
  const summaryPreviousClose = number(summary?.stck_prdy_clpr);
  const previousClose = summaryPreviousClose > 0 ? summaryPreviousClose : number(previousCloseFallback);
  if (!Number.isFinite(previousClose) || previousClose <= 0) return undefined;
  const changePrice = latest.price - previousClose;
  const volume = number(summary?.acml_vol);
  return {
    tradeDate,
    quote: {
      chartCode: code, price: latest.price, previousClose, changePrice, change: (changePrice / previousClose) * 100,
      ...(Number.isFinite(volume) && volume >= 0 ? { volume: String(volume) } : {}),
      asOf: nxtAsOf(tradeDate, latest.hour), fetchedAt, marketStatus: 'CLOSE', priceSource: 'kis-nxt-close', priceSession: 'after',
    },
  };
}
