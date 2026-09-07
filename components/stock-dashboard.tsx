'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Expand, Pause, Play, RefreshCw, Type } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination, PaginationContent, PaginationItem } from '@/components/ui/pagination';
import { fitBoard } from '@/lib/board-layout';
import { makeChartModel, minuteLabel, sessionFor } from '@/lib/chart-model';
import { stockUrl } from '@/lib/stock-links';
import type { IndexQuote, Market, MarketPayload, MinuteSeries, Quote } from '@/lib/market-types';

const markets: Market[] = ['KOSPI', 'KOSDAQ', 'NASDAQ'];
const views = markets.flatMap((market) => [
  { value: market.toLowerCase(), market, graph: false, label: market },
  { value: `${market.toLowerCase()}-chart`, market, graph: true, label: `${market} 그래프` },
]);
const tone = (change: number) => change > 0 ? 'price-up' : change < 0 ? 'price-down' : 'price-flat';
const formatted = (value: number, market: Market) => value.toLocaleString('en-US', {
  minimumFractionDigits: market === 'NASDAQ' ? 2 : 0, maximumFractionDigits: market === 'NASDAQ' ? 2 : 0,
});
const statusLabel = (status?: string) => !status ? '연결 중' : status === 'OPEN' ? '장중' : '장종료';
const REFRESH_MS = 30_000;
type LiveTick = Pick<Quote, 'price' | 'previousClose' | 'change' | 'changePrice' | 'asOf'> & { code: string; market: Market; date: string; minute: number };
type LiveStatus = { state: string; subscribed: number; requested: number };

function Change({ value }: { value: number }) {
  return <span className={`change-rate ${tone(value)}`}>
    <span className="change-arrow" aria-hidden="true">{value > 0 ? '▲' : value < 0 ? '▼' : '–'}</span>
    {value > 0 ? '+' : ''}{value.toFixed(2)}%
  </span>;
}

function Price({ quote, market }: { quote: Quote; market: Market }) {
  return <strong className={`current-price ${tone(quote.change)}`}>{market === 'NASDAQ' ? '$' : ''}{formatted(quote.price, market)}</strong>;
}

function Sparkline({ series: snapshot, tick, market, name, now, width, height }: { series?: MinuteSeries; tick?: LiveTick; market: Market; name: string; now: number; width: number; height: number }) {
  const id = useId().replaceAll(':', '');
  const series = useMemo(() => {
    if (!tick || (snapshot && (snapshot.date > tick.date || (snapshot.date === tick.date && (snapshot.points.at(-1)?.minute ?? 0) > tick.minute)))) return snapshot;
    const points = snapshot?.date === tick.date ? snapshot.points : [];
    return { market, code: tick.code, date: tick.date, previousClose: tick.previousClose, asOf: tick.asOf,
      points: [...points.filter((point) => point.minute !== tick.minute), { minute: tick.minute, price: tick.price }].sort((a, b) => a.minute - b.minute) };
  }, [snapshot, tick, market]);
  const model = useMemo(() => series ? makeChartModel(series, new Date(Math.max(now, tick ? Date.parse(tick.asOf) : 0))) : null, [series, now, tick]);
  const session = sessionFor(market);
  const left = 60, right = width - 8, top = 8, bottom = height - 18;
  const x = (minute: number) => left + (minute - session.start) / (session.end - session.start) * (right - left);
  const y = (price: number) => top + (model?.y(price) ?? 0.5) * (bottom - top);
  const baseline = series && series.previousClose > 0 ? y(series.previousClose) : null;
  const path = model?.points.map((point, index) => `${index ? 'L' : 'M'}${x(point.minute).toFixed(2)},${y(point.price).toFixed(2)}`).join(' ') ?? '';
  const previousLabel = series ? `전일 ${formatted(series.previousClose, market)}` : '';
  return <div className="chart-area">
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} aria-label={`${name} 정규장 분봉, ${minuteLabel(session.start)}~${minuteLabel(session.end)}, ${model?.last ? `${minuteLabel(model.last.minute)}까지` : '데이터 수신 대기'}`}>
      <title>{name} · {previousLabel} · 실제 분봉 · 가격 범위 자동 조절</title>
      {session.ticks.map((minute) => <g key={minute}>
        <line x1={x(minute)} x2={x(minute)} y1={top} y2={bottom} className="chart-grid-line" />
        <text x={x(minute)} y={height - 3} textAnchor={minute === session.start ? 'start' : minute === session.end ? 'end' : 'middle'} className="chart-axis">{minuteLabel(minute)}</text>
      </g>)}
      <line x1={left} x2={right} y1={bottom} y2={bottom} className="chart-grid-line" />
      {model && <>
        <text x={left - 7} y={top + 6} textAnchor="end" className="chart-axis">{formatted(model.yMax, market)}</text>
        <text x={left - 7} y={bottom} textAnchor="end" className="chart-axis">{formatted(model.yMin, market)}</text>
      </>}
      {baseline !== null && <>
        <line x1={left} x2={right} y1={baseline} y2={baseline} className="spark-baseline" />
        <text x={right} y={baseline > top + 16 ? baseline - 5 : baseline + 14} textAnchor="end" className="chart-baseline-label">{previousLabel}</text>
        <defs>
          <clipPath id={`${id}-up`}><rect x={left - 3} y="0" width={right - left + 6} height={baseline} /></clipPath>
          <clipPath id={`${id}-down`}><rect x={left - 3} y={baseline} width={right - left + 6} height={height - baseline} /></clipPath>
        </defs>
      </>}
      {path && <>
        <path d={path} className="price-line" stroke="#df3543" clipPath={baseline !== null ? `url(#${id}-up)` : undefined} />
        {baseline !== null && <path d={path} className="price-line" stroke="#2469d3" clipPath={`url(#${id}-down)`} />}
        {model?.last && <circle cx={x(model.last.minute)} cy={y(model.last.price)} r="3" fill={model.last.price >= (series?.previousClose ?? 0) ? '#df3543' : '#2469d3'} />}
      </>}
      {!model?.points.length && <text x={(left + right) / 2} y={(top + bottom) / 2} textAnchor="middle" className="chart-axis">{series ? '체결된 분봉 없음' : '분봉 수신 중'}</text>}
    </svg>
    {model?.last && <span className="chart-asof">{series?.date.slice(4, 6)}.{series?.date.slice(6, 8)} · {minuteLabel(model.last.minute)}</span>}
  </div>;
}

function Board({ market, graph, payload, largeText, autoRefresh, error, now, provider }: {
  market: Market; graph: boolean; payload?: MarketPayload; largeText: boolean;
  autoRefresh: boolean; error?: string; now: number; provider: 'naver' | 'kis';
}) {
  const area = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [page, setPage] = useState(0);
  const [series, setSeries] = useState<Record<string, MinuteSeries>>({});
  const [chartErrors, setChartErrors] = useState<Record<string, string>>({});
  const [liveTicks, setLiveTicks] = useState<Record<string, LiveTick>>({});
  const [liveStatus, setLiveStatus] = useState<LiveStatus>({ state: 'connecting', subscribed: 0, requested: 0 });
  const quotes = (payload?.stocks ?? []).map((quote) => {
    const tick = liveTicks[quote.chartCode];
    return tick && provider === 'kis' && payload?.marketStatus === 'OPEN' && Date.parse(tick.asOf) >= Date.parse(quote.asOf)
      ? { ...quote, price: tick.price, change: tick.change, changePrice: tick.changePrice, previousClose: tick.previousClose, asOf: tick.asOf } : quote;
  });
  const layout = fitBoard(size.width, size.height, graph, largeText, quotes.length || 100);
  const pageCount = Math.max(1, Math.ceil(quotes.length / layout.capacity));
  const currentPage = Math.min(page, pageCount - 1);
  const offset = currentPage * layout.capacity;
  const visible = quotes.slice(offset, offset + layout.capacity);
  const codes = graph ? visible.map((quote) => quote.chartCode).join(',') : '';
  const liveCodes = visible.map((quote) => quote.chartCode).join(',');

  useEffect(() => {
    if (provider !== 'kis' || !autoRefresh || !liveCodes || !size.width || payload?.marketStatus !== 'OPEN') return;
    let stream: EventSource | undefined;
    const start = () => {
      stream?.close();
      if (document.hidden) return;
      stream = new EventSource(`/api/live?market=${market}&codes=${encodeURIComponent(liveCodes)}`);
      stream.addEventListener('status', (event) => {
        try { setLiveStatus(JSON.parse(event.data) as LiveStatus); } catch { /* Wait for a valid relay event. */ }
      });
      stream.addEventListener('quote', (event) => {
        try {
          const tick = JSON.parse(event.data) as LiveTick;
          if (tick.market !== market || !Number.isFinite(tick.price) || tick.price <= 0 || !liveCodes.split(',').includes(tick.code)) return;
          setLiveTicks((current) => current[tick.code] && Date.parse(current[tick.code].asOf) > Date.parse(tick.asOf) ? current : { ...current, [tick.code]: tick });
        } catch { /* Keep the last received quote. */ }
      });
      stream.onerror = () => setLiveStatus({ state: 'reconnecting', subscribed: 0, requested: liveCodes.split(',').length });
    };
    start();
    document.addEventListener('visibilitychange', start);
    return () => { stream?.close(); document.removeEventListener('visibilitychange', start); };
  }, [provider, autoRefresh, liveCodes, market, size.width, payload?.marketStatus]);

  useEffect(() => {
    if (!area.current) return;
    const update = () => {
      const rectangle = area.current!.getBoundingClientRect();
      setSize({ width: Math.floor(rectangle.width), height: Math.floor(rectangle.height) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(area.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!codes || !size.width) return;
    const controller = new AbortController();
    let active = false;
    const update = async () => {
      if (active) return;
      active = true;
      try {
        const response = await fetch(`/api/chart?market=${market}&codes=${encodeURIComponent(codes)}`, { signal: controller.signal });
        if (!response.ok) throw new Error('분봉 조회 실패');
        const result = await response.json() as { series: Record<string, MinuteSeries>; errors: Record<string, string> };
        if (!controller.signal.aborted) {
          setSeries((current) => ({ ...current, ...result.series }));
          setChartErrors(result.errors);
        }
      } catch {
        if (!controller.signal.aborted) setChartErrors(Object.fromEntries(codes.split(',').map((code) => [code, '분봉 연결 재시도 중'])));
      } finally { active = false; }
    };
    void update();
    const timer = autoRefresh ? window.setInterval(() => { if (!document.hidden) void update(); }, REFRESH_MS) : undefined;
    return () => { controller.abort(); if (timer) window.clearInterval(timer); };
  }, [market, codes, autoRefresh, size.width]);

  const columns = Array.from({ length: layout.columns }, (_, column) => visible.slice(column * layout.rows, (column + 1) * layout.rows));
  const asOf = payload?.asOf ? new Date(payload.asOf).toLocaleString('ko-KR', {
    timeZone: sessionFor(market).timeZone, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }) : '';
  return <section className="board-section">
    <div ref={area} className={`board-viewport ${graph ? 'graph-viewport' : 'quotes-viewport'}`}>
      {!quotes.length ? <output className="board-empty">{error ?? `${market} 시세를 불러오고 있습니다.`}</output> : graph ?
        <div className="graph-grid" style={{ gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))` }}>
          {visible.map((quote, index) => <a className="graph-card" key={quote.code} href={stockUrl(quote, market)} target="_blank" rel="noopener noreferrer" aria-label={`${quote.name} 네이버 증권 새 탭에서 보기`}>
            <div className="graph-card-top">
              <div className="graph-identity"><span className="rank">{offset + index + 1}</span><strong title={`${quote.name} (${quote.code})`}>{quote.name}</strong></div>
              <div className="graph-price"><Price quote={quote} market={market} /><Change value={quote.change} /></div>
            </div>
            <Sparkline series={series[quote.chartCode]} tick={provider === 'kis' && payload?.marketStatus === 'OPEN' && autoRefresh ? liveTicks[quote.chartCode] : undefined} market={market} name={quote.name} now={now} width={Math.max(250, Math.floor(size.width / layout.columns) - 13)} height={Math.max(70, layout.rowHeight - 34)} />
            {chartErrors[quote.chartCode] && <span className="chart-error">{chartErrors[quote.chartCode]}</span>}
          </a>)}
        </div> :
        <div className="quote-columns" style={{ gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))` }}>
          {columns.map((column, columnIndex) => <section className="quote-column" key={columnIndex} tabIndex={0} aria-label={`${market} ${columnIndex + 1}열 시세 스크롤 영역`}>
            <Table className="quote-table">
              <colgroup><col className="rank-col" /><col /><col className="price-col" /><col className="rate-col" /></colgroup>
              <TableHeader><TableRow><TableHead scope="col">#</TableHead><TableHead scope="col">종목명</TableHead><TableHead scope="col">현재가</TableHead><TableHead scope="col">등락률</TableHead></TableRow></TableHeader>
              <TableBody>{column.map((quote, index) => <TableRow key={quote.code} style={{ height: layout.rowHeight }}>
                <TableCell className="rank">{offset + columnIndex * layout.rows + index + 1}</TableCell>
                <TableCell className="stock-name" title={`${quote.name} (${quote.code}) · 거래대금 ${quote.turnover}`}><a href={stockUrl(quote, market)} target="_blank" rel="noopener noreferrer"><strong>{quote.name}</strong></a></TableCell>
                <TableCell><a href={stockUrl(quote, market)} target="_blank" rel="noopener noreferrer" aria-label={`${quote.name} 현재가 상세 보기`}><Price quote={quote} market={market} /></a></TableCell>
                <TableCell><a href={stockUrl(quote, market)} target="_blank" rel="noopener noreferrer" aria-label={`${quote.name} 등락률 상세 보기`}><Change value={quote.change} /></a></TableCell>
              </TableRow>)}</TableBody>
            </Table>
          </section>)}
        </div>}
    </div>
    <footer className="board-footer">
      <p className={error ? 'connection-error' : ''}>{error ?? (payload ? `${statusLabel(payload.marketStatus)} · ${payload.marketStatus === 'OPEN' ? '정규장 현재가' : '정규장 최종가격'} · ${asOf}${market === 'NASDAQ' ? ' ET' : ''} · ${layout.columns}열${graph ? ' · 전일 기준선 · Y축 자동' : ''}` : '네이버 증권 연결 중')}
        {provider === 'kis' && autoRefresh && payload?.marketStatus === 'OPEN' && <span> · {liveStatus.state === 'connected' && liveStatus.subscribed > 0 ? `KIS 구독 ${liveStatus.subscribed}/${visible.length} · 미구독 30초` : 'KIS 연결 대기 · 30초 갱신'}</span>}
      </p>
      <Pagination className="board-pagination" aria-label={`${market} 종목 페이지`}><PaginationContent>
        <PaginationItem><Button variant="ghost" size="icon" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} aria-label="이전 종목"><ChevronLeft /></Button></PaginationItem>
        <PaginationItem><span className="page-indicator">{quotes.length ? `${offset + 1}–${offset + visible.length}` : '0'} / {quotes.length}</span></PaginationItem>
        <PaginationItem><Button variant="ghost" size="icon" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)} aria-label="다음 종목"><ChevronRight /></Button></PaginationItem>
      </PaginationContent></Pagination>
    </footer>
  </section>;
}

export function StockDashboard() {
  const [data, setData] = useState<Partial<Record<Market, MarketPayload>>>({});
  const [indices, setIndices] = useState<IndexQuote[]>([]);
  const [errors, setErrors] = useState<Partial<Record<Market, string>>>({});
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [largeText, setLargeText] = useState(true);
  const [tab, setTab] = useState('kospi');
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState<'naver' | 'kis'>('naver');
  const inFlight = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/runtime', { signal: controller.signal }).then((response) => response.json() as Promise<{ provider: string }>).then((config) => {
      if (!controller.signal.aborted) setProvider(config.provider === 'kis' ? 'kis' : 'naver');
    }).catch(() => { /* The default 30-second provider remains available. */ });
    return () => controller.abort();
  }, []);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await Promise.all(markets.map(async (market) => {
        try {
          const response = await fetch(`/api/market?market=${market}${market === 'KOSPI' ? '&indices=1' : ''}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
          if (!response.ok) throw new Error('시세 연결 재시도 중 · 마지막 수신값 표시');
          const result = await response.json() as MarketPayload;
          if (!result.stocks?.length) throw new Error('시세 수신 대기');
          setData((current) => ({ ...current, [market]: result }));
          setErrors((current) => ({ ...current, [market]: undefined }));
          if (result.indices?.length) setIndices(result.indices);
        } catch (error) {
          setErrors((current) => ({ ...current, [market]: error instanceof Error ? error.message : '시세 연결 재시도 중' }));
        }
      }));
    } finally {
      setNow(Date.now());
      setBusy(false);
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (!autoRefresh) return;
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, REFRESH_MS);
    const onVisibility = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisibility); };
  }, [autoRefresh, refresh]);

  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { /* Fullscreen may be unavailable in an embedded preview. */ }
  };

  return <main className={`terminal-shell ${largeText ? 'large-text' : 'compact'}`}>
    <Tabs value={tab} onValueChange={(value) => setTab(String(value))} className="market-tabs">
    <header className="terminal-header">
      <h1 className="brand-lockup">STOCK<span>11</span></h1>
      <TabsList aria-label="시장 보기 선택" className="market-tab-list">
        {views.map((view) => <TabsTrigger key={view.value} value={view.value}>{view.label}</TabsTrigger>)}
      </TabsList>
      <div className="session-badges">
        <span className={data.KOSPI?.marketStatus === 'OPEN' ? 'session-open' : ''}><i />KRX {statusLabel(data.KOSPI?.marketStatus)}</span>
        <span className={data.NASDAQ?.marketStatus === 'OPEN' ? 'session-open' : ''}><i />미국 {statusLabel(data.NASDAQ?.marketStatus)}</span>
      </div>
      <div className="header-indices" aria-label="주요 시장 지수">
        {['KOSPI', 'KOSDAQ', 'USD/KRW', 'NASDAQ', 'S&P 500'].map((label) => {
          const item = indices.find((index) => index.label === label);
          return <div className="index-item" key={label} title={item?.asOf ? `${label} · ${new Date(item.asOf).toLocaleString('ko-KR')}` : `${label} 수신 대기`}>
            <span className="index-label">{label}</span>
            <strong className={item ? tone(item.change) : ''}>{item ? item.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</strong>
            {item && <span className={`index-change ${tone(item.change)}`}>{item.change > 0 ? '+' : ''}{item.change.toFixed(2)}%</span>}
          </div>;
        })}
      </div>
      <div className="header-actions">
        <span className="refresh-status" title={provider === 'kis' ? 'KIS 체결 수신 · 연결 상태와 구독 수는 하단 표시 · 미구독 종목과 지수는 30초 갱신' : '시세와 분봉을 30초마다 갱신합니다.'}><i className={autoRefresh ? 'on' : ''} />{autoRefresh ? provider === 'kis' ? 'KIS' : '30초' : '멈춤'}</span>
        <Button variant="ghost" size="icon" disabled={busy} onClick={() => void refresh()} aria-label="지금 새로고침" title="지금 새로고침"><RefreshCw className={busy ? 'refreshing' : ''} /></Button>
        <Button variant="ghost" size="icon" onClick={() => setAutoRefresh((value) => !value)} aria-label={autoRefresh ? '자동 갱신 멈춤' : '자동 갱신 시작'} title={autoRefresh ? '자동 갱신 멈춤' : '자동 갱신 시작'}>{autoRefresh ? <Pause /> : <Play />}</Button>
        <Button variant="ghost" size="icon" onClick={() => void fullscreen()} aria-label="전체 화면" title="전체 화면"><Expand /></Button>
        <Button variant="ghost" size="icon" onClick={() => setLargeText((value) => !value)} aria-label="글자 크기 전환" title={largeText ? '많이 보기 (큰 글씨 유지)' : '더 큰 글씨'}><Type /></Button>
      </div>
    </header>
      {views.map((view) => <TabsContent key={view.value} value={view.value} className="market-panel">
        <Board {...view} payload={data[view.market]} largeText={largeText} autoRefresh={autoRefresh} error={errors[view.market]} now={now} provider={provider} />
      </TabsContent>)}
    </Tabs>
  </main>;
}
