import type { Market, Quote } from './market-types';

// Explicit desktop destinations, including when Stock11 is opened on an iPad.
export function stockUrl(quote: Pick<Quote, 'code' | 'chartCode' | 'instrumentType'>, market: Market) {
  return market !== 'KOSPI' && market !== 'KOSDAQ'
    ? quote.instrumentType === 'etf'
      ? `https://stock.naver.com/worldstock/etf/${encodeURIComponent(quote.chartCode)}`
      : `https://stock.naver.com/worldstock/stock/${encodeURIComponent(quote.chartCode)}/total`
    : `https://finance.naver.com/item/main.naver?code=${encodeURIComponent(quote.code)}`;
}
