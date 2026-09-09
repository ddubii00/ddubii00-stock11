import type { Market, StockSelection } from './market-types';

export const WATCHLIST_KEY = 'stock11.watchlist.v1';
export const symbolKey = (item: { market: Market; chartCode: string }) => `${item.market}:${item.chartCode}`;
// Move to the target's position without mutating the saved list or losing metadata.
export function reorderWatchlist<T extends { market: Market; chartCode: string }>(items: T[], source: string, target: string): T[] {
  const from = items.findIndex((item) => symbolKey(item) === source);
  const to = items.findIndex((item) => symbolKey(item) === target);
  if (from < 0 || to < 0 || from === to) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
export function parseSymbols(value: string, limit = 32): { market: Market; chartCode: string }[] | null {
  const entries = [...new Set(value.split(',').filter(Boolean))];
  if (!entries.length || entries.length > limit) return null;
  const result: { market: Market; chartCode: string }[] = [];
  for (const entry of entries) {
    const [market, chartCode, extra] = entry.split(':');
    if (extra !== undefined || !['KOSPI', 'KOSDAQ', 'NASDAQ', 'NYSE', 'AMEX', 'SP500', 'DOW'].includes(market)
      || !/^[A-Za-z0-9.^-]{1,24}$/.test(chartCode ?? '')) return null;
    result.push({ market: market as Market, chartCode });
  }
  return result;
}

export function restoreWatchlist(raw: string | null): StockSelection[] {
  try {
    const value: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(value)) return [];
    return [...new Map(value.filter((item): item is StockSelection => item && typeof item === 'object'
      && ['KOSPI', 'KOSDAQ', 'NASDAQ', 'NYSE', 'AMEX'].includes(item.market)
      && typeof item.name === 'string' && item.name.length > 0 && item.name.length <= 160
      && typeof item.code === 'string' && /^[A-Za-z0-9.^-]{1,24}$/.test(item.code)
      && typeof item.chartCode === 'string' && /^[A-Za-z0-9.^-]{1,24}$/.test(item.chartCode))
      .map((item) => [symbolKey(item), { market: item.market, name: item.name, code: item.code, chartCode: item.chartCode,
        ...(item.instrumentType === 'etf' ? { instrumentType: 'etf' as const } : {}) }])).values()].slice(0, 200);
  } catch { return []; }
}
