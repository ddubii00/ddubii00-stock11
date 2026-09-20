function number(value) { return Number(String(value ?? '').replaceAll(',', '')); }
function signed(value, sign) {
  const parsed = number(value);
  if (!Number.isFinite(parsed)) return parsed;
  return ['4', '5'].includes(String(sign)) ? -Math.abs(parsed) : String(sign) === '3' ? 0 : parsed;
}

export function dailyRows(body) {
  if (Array.isArray(body?.output)) return body.output;
  if (body?.output && typeof body.output === 'object') return [body.output];
  return [];
}

export function regularCloseAsOf(date) {
  if (!/^\d{8}$/.test(date)) return '';
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T15:30:00+09:00`;
}

export function parseRegularDailyClose(body, code, fetchedAt = new Date().toISOString()) {
  const rows = dailyRows(body)
    .filter((row) => /^\d{8}$/.test(String(row?.stck_bsop_date ?? '')) && Number.isFinite(number(row?.stck_clpr)) && number(row.stck_clpr) > 0)
    .sort((left, right) => String(right.stck_bsop_date).localeCompare(String(left.stck_bsop_date)));
  const row = rows[0];
  if (!row) return undefined;
  const tradeDate = String(row.stck_bsop_date);
  const price = number(row.stck_clpr);
  const changePrice = signed(row.prdy_vrss, row.prdy_vrss_sign);
  const change = signed(row.prdy_ctrt, row.prdy_vrss_sign);
  const previousClose = price - changePrice;
  if (![price, changePrice, change, previousClose].every(Number.isFinite) || price <= 0 || previousClose <= 0) return undefined;
  const volume = number(row.acml_vol);
  return {
    tradeDate,
    quote: {
      chartCode: code, price, previousClose, changePrice, change,
      ...(Number.isFinite(volume) ? { volume: String(volume) } : {}),
      asOf: regularCloseAsOf(tradeDate), fetchedAt, marketStatus: 'CLOSE',
      priceSource: 'kis-daily-close', priceSession: 'regular',
    },
  };
}
