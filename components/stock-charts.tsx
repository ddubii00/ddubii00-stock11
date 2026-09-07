'use client';
/* eslint-disable jsx-a11y/prefer-tag-over-role -- SVG charts need an accessible image role; an HTML img cannot contain these live paths. */
import { useId, useMemo } from 'react';
import { makeChartModel, minuteLabel } from '@/lib/chart-model';
import type { CandleSeries, Market, MinuteSeries, Quote } from '@/lib/market-types';

export type LiveTick = Pick<Quote, 'price' | 'previousClose' | 'change' | 'changePrice' | 'asOf'> & { code: string; market: Market; date: string; minute: number };
export function Sparkline({ series: snapshot, tick, name, now, mini = false }: {
  series?: MinuteSeries; tick?: LiveTick; name: string; now: number; mini?: boolean;
}) {
  const id = useId().replaceAll(':', '');
  const series = useMemo(() => {
    if (!tick || (snapshot && (snapshot.date > tick.date || (snapshot.date === tick.date && (snapshot.points.at(-1)?.minute ?? 0) > tick.minute)))) return snapshot;
    const points = snapshot?.date === tick.date ? snapshot.points : [];
    return { market: tick.market, code: tick.code, date: tick.date, previousClose: tick.previousClose, asOf: tick.asOf,
      points: [...points.filter((point) => point.minute !== tick.minute), { minute: tick.minute, price: tick.price }].sort((a, b) => a.minute - b.minute) };
  }, [snapshot, tick]);
  const model = useMemo(() => series ? makeChartModel(series, new Date(Math.max(now, tick ? Date.parse(tick.asOf) : 0))) : null, [series, now, tick]);
  const width = 180, height = 48, left = 3, right = 177, top = 3, bottom = 45;
  const x = (minute: number) => left + (model?.x(minute) ?? 0) * (right - left);
  const y = (price: number) => top + (model?.y(price) ?? .5) * (bottom - top);
  const baseline = series && series.previousClose > 0 ? y(series.previousClose) : null;
  const path = model?.points.map((point, index) => `${index ? 'L' : 'M'}${x(point.minute).toFixed(2)},${y(point.price).toFixed(2)}`).join(' ') ?? '';
  const detail = `${name} · ${series?.date ?? ''} · 전일 ${series?.previousClose ?? '미수신'} · ${model?.last ? `${minuteLabel(model.last.minute)}까지 실제 분봉` : '분봉 미수신'}`;
  return <div className={`chart-area ${mini ? 'mini-chart' : ''}`} title={detail}>
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={detail}>
      <title>{detail} · 정규장 전체 시간축 · 가격 범위 자동 조절</title>
      {baseline !== null && <>
        <line x1={left} x2={right} y1={baseline} y2={baseline} className="spark-baseline" vectorEffect="non-scaling-stroke" />
        <defs>
          <clipPath id={`${id}-up`}><rect width={width} height={baseline} /></clipPath>
          <clipPath id={`${id}-down`}><rect y={baseline} width={width} height={height - baseline} /></clipPath>
        </defs>
      </>}
      {path && <>
        <path d={path} className="price-line" stroke="#df3543" clipPath={baseline !== null ? `url(#${id}-up)` : undefined} vectorEffect="non-scaling-stroke" />
        {baseline !== null && <path d={path} className="price-line" stroke="#2469d3" clipPath={`url(#${id}-down)`} vectorEffect="non-scaling-stroke" />}
        {model?.points.length === 1 && model.last && <circle cx={x(model.last.minute)} cy={y(model.last.price)} r="2" fill={model.last.price >= (series?.previousClose ?? 0) ? '#df3543' : '#2469d3'} />}
      </>}
      {!model?.points.length && <text x="90" y="27" textAnchor="middle" className="chart-axis">{mini ? '—' : series ? '분봉 없음' : '수신 대기'}</text>}
    </svg>
  </div>;
}

export function Candlestick({ series, previousClose, name }: { series?: CandleSeries; previousClose: number; name: string }) {
  const bars = series?.candles ?? [];
  const values = bars.flatMap((bar) => [bar.low, bar.high]);
  if (previousClose > 0) values.push(previousClose);
  const low = Math.min(...values), high = Math.max(...values), span = Math.max(high - low, high * .001, .01);
  const y = (price: number) => 4 + (high + span * .08 - price) / (span * 1.16) * 40;
  const step = 174 / Math.max(bars.length, 1);
  return <div className="chart-area candle-area">
    <svg className="sparkline" viewBox="0 0 180 48" preserveAspectRatio="none" role="img" aria-label={`${name} 최근 1개월 일봉 · 실제 시가 고가 저가 종가`}>
      <title>{name} · 최근 1개월 일봉 · {bars.at(-1)?.date ?? '수신 대기'} · 봉 색은 시가 대비</title>
      {bars.length > 0 && previousClose > 0 && <line x1="3" x2="177" y1={y(previousClose)} y2={y(previousClose)} className="spark-baseline" vectorEffect="non-scaling-stroke" />}
      {bars.map((bar, index) => {
        const x = 3 + step * (index + .5), color = bar.close >= bar.open ? '#df3543' : '#2469d3';
        return <g key={bar.date} fill={color} stroke={color}>
          <title>{bar.date} · 시 {bar.open} · 고 {bar.high} · 저 {bar.low} · 종 {bar.close}</title>
          <line x1={x} x2={x} y1={y(bar.high)} y2={y(bar.low)} strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <rect x={x - step * .3} y={Math.min(y(bar.open), y(bar.close))} width={Math.max(.8, step * .6)} height={Math.max(.8, Math.abs(y(bar.open) - y(bar.close)))} stroke="none" />
        </g>;
      })}
      {!bars.length && <text x="90" y="27" textAnchor="middle" className="chart-axis">봉 수신 대기</text>}
    </svg>
  </div>;
}
