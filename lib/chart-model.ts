import type { Market, MinuteSeries } from './market-types';

export function sessionFor(market: Market) {
  return market === 'NASDAQ'
    ? { start: 570, end: 960, timeZone: 'America/New_York', ticks: [570, 720, 840, 960] }
    : { start: 540, end: 930, timeZone: 'Asia/Seoul', ticks: [540, 660, 780, 930] };
}

export function clockInZone(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    date: value('year') + value('month') + value('day'),
    minute: Number(value('hour')) * 60 + Number(value('minute')),
  };
}

export function minuteLabel(minute: number) {
  return `${Math.floor(minute / 60).toString().padStart(2, '0')}:${Math.floor(minute % 60).toString().padStart(2, '0')}`;
}

// Always use the entire regular session for X, not the number of received points.
export function makeChartModel(series: MinuteSeries, now = new Date()) {
  const session = sessionFor(series.market);
  const clock = clockInZone(now, session.timeZone);
  const cutoff = series.date < clock.date ? session.end
    : series.date === clock.date ? Math.min(clock.minute, session.end) : session.start - 1;
  const unique = new Map(series.points.filter((point) =>
    Number.isFinite(point.price) && point.price > 0 && Number.isFinite(point.minute)
    && point.minute >= session.start && point.minute <= cutoff,
  ).map((point) => [point.minute, point]));
  const points = [...unique.values()].sort((a, b) => a.minute - b.minute);
  const values = points.map((point) => point.price);
  if (series.previousClose > 0) values.push(series.previousClose);
  if (!values.length) values.push(1);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const smallestSpan = series.market === 'NASDAQ' ? 0.02 : 2;
  const span = Math.max(maximum - minimum, smallestSpan);
  const pad = span * 0.1;
  const yMin = maximum === minimum ? minimum - span / 2 - pad : minimum - pad;
  const yMax = maximum === minimum ? maximum + span / 2 + pad : maximum + pad;
  const x = (minute: number) => (minute - session.start) / (session.end - session.start);
  const y = (price: number) => (yMax - price) / (yMax - yMin);
  return { session, points, x, y, yMin, yMax, cutoff, last: points.at(-1) };
}
