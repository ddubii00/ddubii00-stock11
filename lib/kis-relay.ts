import type { Market, Quote } from './market-types';

type RelayQuote = Pick<Quote, 'chartCode' | 'price' | 'previousClose' | 'change' | 'changePrice' | 'asOf' | 'fetchedAt' | 'marketStatus' | 'volume' | 'priceSource' | 'priceSession'> & { name?: string };
type RelayPayload = { quotes?: Record<string, RelayQuote>; source?: string; refreshMs?: number };
export type KisQuoteResult = { quotes: Record<string, RelayQuote>; source?: string; refreshMs?: number };

export const kisEnabled = () => process.env.VERCEL !== '1' && process.env.STOCK11_DATA_PROVIDER === 'kis';
const domestic = (market: Market) => market === 'KOSPI' || market === 'KOSDAQ';
const validCode = (code: string) => /^[A-Za-z0-9.^-]{1,24}$/.test(code);

// The application never receives an App Key, secret, or bearer token.  The
// private Docker relay owns all KIS authentication and is intentionally the
// only process allowed to make a KIS REST call.
export async function readKisQuoteResult(market: Market, codes: string[], afterMarket: boolean, scope: 'watch' | 'visible' | 'background' = 'visible'): Promise<KisQuoteResult> {
  if (!kisEnabled() || !codes.length || codes.length > 200 || codes.some((code) => !validCode(code))) return { quotes: {} };
  const url = new URL('/quotes', process.env.KIS_RELAY_URL || 'http://127.0.0.1:8091');
  url.searchParams.set('market', market);
  url.searchParams.set('codes', codes.join(','));
  url.searchParams.set('scope', scope);
  if (afterMarket && domestic(market)) url.searchParams.set('after', '1');
  try {
    // Closed-session KRX uses one official daily-price request per visible
    // symbol. Give that bounded queue time to finish instead of falling back
    // to Naver's integrated close before the verified KRX close arrives.
    const timeout = scope === 'watch' ? 45_000 : scope === 'visible' ? 14_000 : 8_500;
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(timeout) });
    if (!response.ok) return { quotes: {} };
    const payload = await response.json() as RelayPayload;
    return { quotes: payload.quotes ?? {}, source: payload.source, refreshMs: payload.refreshMs };
  } catch { return { quotes: {} }; }
}

export async function readKisQuotes(market: Market, codes: string[], afterMarket: boolean, scope: 'watch' | 'visible' | 'background' = 'visible'): Promise<Record<string, RelayQuote>> {
  return (await readKisQuoteResult(market, codes, afterMarket, scope)).quotes;
}

export function mergeKisQuotes(fallback: Quote[], kis: Record<string, RelayQuote>, afterMarket: boolean): Quote[] {
  return fallback.map((quote) => {
    const live = kis[quote.chartCode];
    if (!live || !Number.isFinite(live.price) || live.price <= 0) return { ...quote, priceSource: 'naver-fallback', priceSession: afterMarket ? 'after' : 'regular' };
    // A regular KRX request can only consume a regular relay quote.  This is
    // the hard boundary that prevents a 20:00 unified price replacing 15:30.
    // KRX2 is regular during 09:00–15:30 and integrated only for the later
    // session; the relay returns its actual session explicitly.  Never accept
    // an after quote for the plain KRX view.
    if (live.priceSession !== 'regular' && live.priceSession !== 'after') return { ...quote, priceSource: 'naver-fallback', priceSession: afterMarket ? 'after' : 'regular' };
    if (!afterMarket && live.priceSession !== 'regular') return { ...quote, priceSource: 'naver-fallback', priceSession: 'regular' };
    return { ...quote, ...live, chartCode: quote.chartCode, priceSource: live.priceSource ?? 'kis-rest', priceSession: live.priceSession };
  });
}
