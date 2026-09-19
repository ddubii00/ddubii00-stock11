import type { Market, Quote } from './market-types';

type RelayQuote = Pick<Quote, 'chartCode' | 'price' | 'previousClose' | 'change' | 'changePrice' | 'asOf' | 'fetchedAt' | 'marketStatus' | 'volume' | 'priceSource' | 'priceSession'>;
type RelayPayload = { quotes?: Record<string, RelayQuote>; source?: string };

export const kisEnabled = () => process.env.VERCEL !== '1' && process.env.STOCK11_DATA_PROVIDER === 'kis';
const domestic = (market: Market) => market === 'KOSPI' || market === 'KOSDAQ';
const validCode = (code: string) => /^[A-Za-z0-9.^-]{1,24}$/.test(code);

// The application never receives an App Key, secret, or bearer token.  The
// private Docker relay owns all KIS authentication and is intentionally the
// only process allowed to make a KIS REST call.
export async function readKisQuotes(market: Market, codes: string[], afterMarket: boolean): Promise<Record<string, RelayQuote>> {
  if (!kisEnabled() || !codes.length || codes.length > 40 || codes.some((code) => !validCode(code))) return {};
  // KIS domestic REST supports J (regular KRX) and UN (unified KRX/NXT).  The
  // relay can still return its WebSocket cache for overseas symbols.
  const url = new URL('/quotes', process.env.KIS_RELAY_URL || 'http://127.0.0.1:8091');
  url.searchParams.set('market', market);
  url.searchParams.set('codes', codes.join(','));
  if (afterMarket && domestic(market)) url.searchParams.set('after', '1');
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8500) });
    if (!response.ok) return {};
    const payload = await response.json() as RelayPayload;
    return payload.quotes ?? {};
  } catch { return {}; }
}

export function mergeKisQuotes(fallback: Quote[], kis: Record<string, RelayQuote>, afterMarket: boolean): Quote[] {
  return fallback.map((quote) => {
    const live = kis[quote.chartCode];
    if (!live || !Number.isFinite(live.price) || live.price <= 0) return { ...quote, priceSource: 'naver-fallback', priceSession: afterMarket ? 'after' : 'regular' };
    // A regular KRX request can only consume a regular relay quote.  This is
    // the hard boundary that prevents a 20:00 unified price replacing 15:30.
    if ((afterMarket ? 'after' : 'regular') !== live.priceSession) return { ...quote, priceSource: 'naver-fallback', priceSession: afterMarket ? 'after' : 'regular' };
    return { ...quote, ...live, chartCode: quote.chartCode, priceSource: live.priceSource ?? 'kis-rest', priceSession: live.priceSession };
  });
}
