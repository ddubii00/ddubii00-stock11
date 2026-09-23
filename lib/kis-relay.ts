import type { Market, MinutePoint, Quote } from './market-types';

type RelayQuote = Pick<Quote, 'chartCode' | 'price' | 'previousClose' | 'change' | 'changePrice' | 'asOf' | 'fetchedAt' | 'marketStatus' | 'volume' | 'priceSource' | 'priceSession'> & { name?: string };
type RelayPayload = { quotes?: Record<string, RelayQuote>; source?: string; refreshMs?: number };
export type KisQuoteResult = { quotes: Record<string, RelayQuote>; source?: string; refreshMs?: number };

export const kisEnabled = () => process.env.VERCEL !== '1' && process.env.STOCK11_DATA_PROVIDER === 'kis';
const domestic = (market: Market | undefined) => market === 'KOSPI' || market === 'KOSDAQ';
const validCode = (code: string) => /^[A-Za-z0-9.^-]{1,24}$/.test(code);

// The web application never receives the KIS App Key, secret, or bearer token.
// All individual-stock prices come only from the private Oracle KIS REST relay.
export async function readKisQuoteResult(
  market: Market,
  codes: string[],
  afterMarket: boolean,
  scope: 'watch' | 'visible' | 'background' = 'visible',
): Promise<KisQuoteResult> {
  if (!kisEnabled() || !codes.length || codes.length > 200 || codes.some((code) => !validCode(code))) {
    return { quotes: {} };
  }

  const url = new URL('/quotes', process.env.KIS_RELAY_URL || 'http://127.0.0.1:8091');
  url.searchParams.set('market', market);
  url.searchParams.set('codes', codes.join(','));
  url.searchParams.set('scope', scope);
  if (afterMarket && domestic(market)) url.searchParams.set('after', '1');

  try {
    const timeout = scope === 'watch' ? 45_000 : scope === 'visible' ? 20_000 : 12_000;
    const response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) return { quotes: {} };

    const payload = await response.json() as RelayPayload;
    return {
      quotes: payload.quotes ?? {},
      source: payload.source,
      refreshMs: payload.refreshMs,
    };
  } catch {
    return { quotes: {} };
  }
}

export async function readKisQuotes(
  market: Market,
  codes: string[],
  afterMarket: boolean,
  scope: 'watch' | 'visible' | 'background' = 'visible',
): Promise<Record<string, RelayQuote>> {
  return (await readKisQuoteResult(market, codes, afterMarket, scope)).quotes;
}

type PremarketMinutes = { points: MinutePoint[]; previousClose?: number };
export async function readKisPremarketMinutes(market: Market, code: string, date: string): Promise<PremarketMinutes> {
  if (!kisEnabled() || !domestic(market) || !/^[A-Za-z0-9]{6}$/.test(code) || !/^\d{8}$/.test(date)) return { points: [] };
  const url = new URL('/premarket-minutes', process.env.KIS_RELAY_URL || 'http://127.0.0.1:8091');
  url.searchParams.set('market', market);
  url.searchParams.set('code', code);
  url.searchParams.set('date', date);
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(25_000) });
    if (!response.ok) return { points: [] };
    const payload = await response.json() as PremarketMinutes;
    return { points: (Array.isArray(payload.points) ? payload.points : []).filter((point) => Number.isInteger(point.minute)
      && point.minute >= 480 && point.minute <= 530 && Number.isFinite(point.price) && point.price > 0),
    ...(Number.isFinite(payload.previousClose) && Number(payload.previousClose) > 0 ? { previousClose: payload.previousClose } : {}) };
  } catch { return { points: [] }; }
}

// Naver remains useful for names/list membership and the already-working minute
// charts, but it is never allowed to supply an individual-stock price.
// If KIS has not returned a price, show "pending" instead of yesterday's Naver
// value. This prevents a stale fallback from looking like a valid live quote.
export function mergeKisQuotes(metadata: Quote[], kis: Record<string, RelayQuote>, afterMarket: boolean): Quote[] {
  return metadata.map((quote) => {
    const live = kis[quote.chartCode];
    const isDomestic = domestic(quote.market);
    const sessionMismatch = Boolean(
      live
      && isDomestic
      && (
        (!afterMarket && live.priceSession !== 'regular')
        || (afterMarket && live.priceSession !== 'regular' && live.priceSession !== 'after')
      )
    );

    if (!live || !Number.isFinite(live.price) || live.price <= 0 || sessionMismatch) {
      return {
        ...quote,
        price: 0,
        previousClose: 0,
        change: 0,
        changePrice: 0,
        turnover: '—',
        volume: '—',
        asOf: '',
        fetchedAt: undefined,
        pending: true,
        priceSource: undefined,
        priceSession: isDomestic && afterMarket ? 'after' : 'regular',
      };
    }

    return {
      ...quote,
      ...live,
      chartCode: quote.chartCode,
      turnover: '—',
      volume: live.volume ?? '—',
      asOf: live.asOf || live.fetchedAt || '',
      pending: false,
      priceSource: live.priceSource ?? 'kis-rest',
      priceSession: live.priceSession ?? 'regular',
    };
  });
}
