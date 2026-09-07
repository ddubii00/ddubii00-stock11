export type Market = 'KOSPI' | 'KOSDAQ' | 'NASDAQ';

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
export type MinuteSeries = {
  code: string;
  market: Market;
  date: string;
  previousClose: number;
  points: MinutePoint[];
  asOf: string;
};
