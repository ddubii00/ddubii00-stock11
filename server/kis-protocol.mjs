// Quote-only KIS WebSocket messages. No account, order, or execution-notice TRs.
export function subscription(market, code) {
  if (market === 'NASDAQ' && /^[A-Z0-9-]{1,12}\.O$/.test(code)) {
    return { id: `HDFSCNT0:DNAS${code.slice(0, -2)}`, trId: 'HDFSCNT0', key: `DNAS${code.slice(0, -2)}`, code };
  }
  if (['KOSPI', 'KOSDAQ'].includes(market) && /^[A-Za-z0-9]{6}$/.test(code)) {
    return { id: `H0STCNT0:${code}`, trId: 'H0STCNT0', key: code, code };
  }
  return null;
}

const isoKorea = (date, time) => `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}+09:00`;
const signed = (value, sign) => Math.abs(Number(value)) * (['4', '5'].includes(sign) ? -1 : sign === '3' ? 0 : 1);

export function parseTrades(message) {
  const [kind, trId, countText, payload] = message.split('|');
  const foreign = trId === 'HDFSCNT0';
  if (kind !== '0' || (!foreign && trId !== 'H0STCNT0') || !payload) return [];
  const count = Number(countText), stride = foreign ? 26 : 46;
  const fields = payload.split('^');
  if (!Number.isInteger(count) || count < 1 || count > 100 || (fields.length !== count * stride && !(fields.length === count * stride + 1 && fields.at(-1) === ''))) return [];
  const ticks = [];
  for (let index = 0; index < count; index++) {
    const row = fields.slice(index * stride, (index + 1) * stride);
    const date = row[foreign ? 4 : 33], time = row[foreign ? 5 : 1];
    if (!/^\d{8}$/.test(date) || !/^\d{6}$/.test(time)) continue;
    const seconds = Number(time.slice(0, 2)) * 3600 + Number(time.slice(2, 4)) * 60 + Number(time.slice(4, 6));
    // Time-of-day filtering deliberately excludes pre/post-market prices.
    if (seconds < (foreign ? 570 : 540) * 60 || seconds > (foreign ? 960 : 930) * 60) continue;
    const price = Number(row[foreign ? 11 : 2]);
    const change = signed(row[foreign ? 14 : 5], row[foreign ? 12 : 3]);
    const changePrice = signed(row[foreign ? 13 : 4], row[foreign ? 12 : 3]);
    const asOf = isoKorea(foreign ? row[6] : date, foreign ? row[7] : time);
    if (![price, change, changePrice, Date.parse(asOf)].every(Number.isFinite) || price <= 0 || price - changePrice <= 0) continue;
    ticks.push({ subscriptionId: `${trId}:${row[0]}`, price, change, changePrice, previousClose: price - changePrice, date, minute: Math.floor(seconds / 60), asOf });
  }
  return ticks;
}
