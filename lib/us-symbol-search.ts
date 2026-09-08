// Official Nasdaq symbol directories include US stocks and ETFs on all exchanges.
// Use them for substring discovery only; resolve provider identifiers separately.
type SymbolEntry = { code: string; name: string; etf: boolean };
const normalize = (text: string) => text.toLocaleLowerCase('en-US').replace(/[^a-z0-9]/g, '');
export function parseSymbolDirectory(text: string): SymbolEntry[] {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const fields = header.split('|');
  const symbol = fields.indexOf('Symbol') >= 0 ? fields.indexOf('Symbol') : fields.indexOf('ACT Symbol');
  const name = fields.indexOf('Security Name'), test = fields.indexOf('Test Issue'), etf = fields.indexOf('ETF');
  if ([symbol, name, test, etf].some((index) => index < 0)) return [];
  return lines.flatMap((line) => {
    const row = line.split('|');
    return row[test] === 'N' && /^[A-Za-z0-9.-]{1,24}$/.test(row[symbol] ?? '') && row[name]
      ? [{ code: row[symbol], name: row[name], etf: row[etf] === 'Y' }] : [];
  });
}
export function matchSymbols(items: SymbolEntry[], query: string): SymbolEntry[] {
  const needle = normalize(query);
  if (needle.length < 2) return [];
  const score = (item: SymbolEntry) => normalize(item.code) === needle ? 0 : normalize(item.name).startsWith(needle) ? 1 : 2;
  return items.filter((item) => normalize(item.code).includes(needle) || normalize(item.name).includes(needle))
    .sort((a, b) => score(a) - score(b) || a.code.localeCompare(b.code)).slice(0, 10);
}
let cache: { expires: number; items: SymbolEntry[] } | undefined;
let pending: Promise<SymbolEntry[]> | undefined;
export async function searchUsSymbols(query: string): Promise<SymbolEntry[]> {
  if (!/[a-z]/i.test(query) || /[^\x20-\x7e]/.test(query) || normalize(query).length < 2) return [];
  if (!cache || cache.expires <= Date.now()) {
    pending ??= Promise.allSettled(['nasdaqlisted.txt', 'otherlisted.txt'].map(async (file) => {
      const response = await fetch(`https://www.nasdaqtrader.com/dynamic/SymDir/${file}`, { cache: 'no-store', signal: AbortSignal.timeout(6000) });
      if (!response.ok) throw new Error('미국 종목 목록 수신 실패');
      return parseSymbolDirectory(await response.text());
    })).then((results) => {
      const items = [...new Map(results.flatMap((result) => result.status === 'fulfilled' ? result.value : []).map((item) => [item.code, item])).values()];
      // Retain a previous catalog during a provider outage and retry shortly.
      cache = { expires: Date.now() + (results.every((result) => result.status === 'fulfilled') && items.length ? 6 * 60 * 60_000 : 60_000), items: items.length ? items : cache?.items ?? [] };
      return cache.items;
    }).finally(() => { pending = undefined; });
    await pending;
  }
  return matchSymbols(cache?.items ?? [], query);
}
