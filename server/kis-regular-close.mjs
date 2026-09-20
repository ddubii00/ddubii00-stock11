function number(value) {
  const text = String(value ?? '').replaceAll(',', '').trim();
  return text ? Number(text) : Number.NaN;
}

function output1(body) {
  if (Array.isArray(body?.output1)) return body.output1[0] ?? {};
  return body?.output1 && typeof body.output1 === 'object' ? body.output1 : {};
}

function output2(body) { return Array.isArray(body?.output2) ? body.output2 : []; }

function regularAsOf(date, hour) {
  if (!/^\d{8}$/.test(date) || !/^\d{6}$/.test(hour)) return '';
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${hour.slice(0, 2)}:${hour.slice(2, 4)}:${hour.slice(4, 6)}+09:00`;
}

// Closed-session KRX must be reconstructed from actual J-market intraday
// trades. KIS daily-price can reflect the later NXT close for some symbols,
// so its stck_clpr must not be treated as the immutable 15:30 KRX close.
export function parseRegularHistoricalClose(body, code, tradeDate, fetchedAt = new Date().toISOString()) {
  const rows = output2(body)
    .map((row) => ({
      row,
      date: String(row?.stck_bsop_date ?? ''),
      hour: String(row?.stck_cntg_hour ?? '').padStart(6, '0'),
      price: number(row?.stck_prpr),
    }))
    .filter(({ date, hour, price }) => date === tradeDate && /^\d{6}$/.test(hour)
      && hour >= '090000' && hour <= '153000' && Number.isFinite(price) && price > 0)
    .sort((left, right) => right.hour.localeCompare(left.hour));

  const latest = rows[0];
  if (!latest) return undefined;

  const summary = output1(body);
  const previousClose = number(summary?.stck_prdy_clpr);
  if (!Number.isFinite(previousClose) || previousClose <= 0) return undefined;

  const changePrice = latest.price - previousClose;
  const volume = number(summary?.acml_vol);

  return {
    tradeDate,
    quote: {
      chartCode: code,
      price: latest.price,
      previousClose,
      changePrice,
      change: (changePrice / previousClose) * 100,
      ...(Number.isFinite(volume) && volume >= 0 ? { volume: String(volume) } : {}),
      asOf: regularAsOf(tradeDate, latest.hour),
      fetchedAt,
      marketStatus: 'CLOSE',
      priceSource: 'kis-regular-close',
      priceSession: 'regular',
    },
  };
}
