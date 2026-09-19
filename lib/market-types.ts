export type Market = 'KOSPI' | 'KOSDAQ' | 'NASDAQ' | 'NYSE' | 'AMEX' | 'SP500' | 'DOW';
export type StockSelection = { code: string; chartCode: string; name: string; market: Exclude<Market, 'SP500' | 'DOW'>; instrumentType?: 'etf' };

export type Quote = {
  code: string;
  chartCode: string;
  name: string;
  price: number;
  previousClose: number;
  change: number;
  changePrice: number;
  turnover: string;
  volume?: string;
  asOf: string;
  market?: Exclude<Market, 'SP500' | 'DOW'>;
  marketStatus?: string;
  /** The provider that determined this price, not merely the page provider. */
  priceSource?: 'kis-live' | 'kis-rest' | 'kis-cache' | 'naver-fallback';
  /** KRX is the 15:30 regular close; UN is the KRX/NXT unified after session. */
  priceSession?: 'regular' | 'after';
  pending?: boolean;
  instrumentType?: 'etf';
};

export type IndexQuote = {
  label: string;
  value: number;
  change: number;
  asOf: string;
};

export type MarketPayload = {
  stocks: Quote[];
  indices: IndexQuote[];
  marketStatus: string;
  asOf: string;
  source: string;
};

export type MinutePoint = { minute: number; price: number };
export type Candle = { date: string; open: number; high: number; low: number; close: number };
export type CandleSeries = { code: string; candles: Candle[]; interval: 'day' };
export type MinuteSeries = {
  code: string;
  market: Market | 'FX';
  session?: { start: number; end: number; timeZone: string; ticks: number[] };
  date: string;
  previousClose: number;
  points: MinutePoint[];
  asOf: string;
};
