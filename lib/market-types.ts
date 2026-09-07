export type Market = 'KOSPI' | 'KOSDAQ' | 'NASDAQ' | 'NYSE' | 'AMEX' | 'SP500';
export type StockSelection = { code: string; chartCode: string; name: string; market: Exclude<Market, 'SP500'> };

export type Quote = {
  code: string;
  chartCode: string;
  name: string;
  price: number;
  previousClose: number;
  change: number;
  changePrice: number;
  turnover: string;
  asOf: string;
  market?: Exclude<Market, 'SP500'>;
  marketStatus?: string;
  pending?: boolean;
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
