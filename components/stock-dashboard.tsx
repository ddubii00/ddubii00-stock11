'use client';
/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- Independently scrolling stock tables need keyboard focus for arrow-key scrolling. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Expand, Pause, Play, RefreshCw, Type, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination, PaginationContent, PaginationItem } from '@/components/ui/pagination';
import { fitBoard } from '@/lib/board-layout';
import { sessionFor } from '@/lib/chart-model';
import { Sparkline, type LiveTick } from '@/components/stock-charts';
import { WatchlistToolbar } from '@/components/watchlist-toolbar';
import { restoreWatchlist, symbolKey, WATCHLIST_KEY } from '@/lib/watchlist';
import { stockUrl } from '@/lib/stock-links';
import type { IndexQuote, Market, MarketPayload, MinuteSeries, Quote, StockSelection } from '@/lib/market-types';

const markets: Market[] = ['KOSPI', 'KOSDAQ', 'NASDAQ', 'SP500'];
const marketLabel = (market: Market) => market === 'SP500' ? 'S&P500' : market;
const isUS = (market: Market) => market !== 'KOSPI' && market !== 'KOSDAQ';
const views = markets.flatMap((market) => [
  { value: market.toLowerCase(), market, graph: false, label: marketLabel(market) },
  { value: `${market.toLowerCase()}-chart`, market, graph: true, label: `${marketLabel(market)} 차트` },
]);
const tone = (change: number) => change > 0 ? 'price-up' : change < 0 ? 'price-down' : 'price-flat';
const formatted = (value: number, market: Market) => value.toLocaleString('en-US', {
  minimumFractionDigits: isUS(market) ? 2 : 0, maximumFractionDigits: isUS(market) ? 2 : 0,
});
const statusLabel = (status?: string) => !status ? '연결 중' : status === 'OPEN' ? '장중' : '장종료';
const REFRESH_MS = 30_000;
type LiveStatus = { state: string; subscribed: number; requested: number };

function Change({ value }: { value: number }) {
  return <span className={`change-rate ${tone(value)}`}>
    <span className="change-arrow" style={{ fontSize: 8 + Math.min(Math.abs(value), 10) * .7 }} aria-hidden="true">{value > 0 ? '▲' : value < 0 ? '▼' : '–'}</span>
    {value > 0 ? '+' : ''}{value.toFixed(2)}%
  </span>;
}

function Price({ quote, market }: { quote: Quote; market: Market }) {
  if (quote.pending) return <strong className="current-price price-flat">—</strong>;
  return <strong className={`current-price ${tone(quote.change)}`}>{isUS(market) ? '$' : ''}{formatted(quote.price, market)}</strong>;
}

export function Board({ market, graph, payload, largeText, autoRefresh, error, now, provider, watch = false, onRemove }: {
  market: Market; graph: boolean; payload?: MarketPayload; largeText: boolean;
  autoRefresh: boolean; error?: string; now: number; provider: 'naver' | 'kis';
  watch?: boolean; onRemove?: (quote: Quote) => void;
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
    return tick && provider === 'kis' && (quote.marketStatus ?? payload?.marketStatus) === 'OPEN' && Date.parse(tick.asOf) >= Date.parse(quote.asOf)
      ? { ...quote, price: tick.price, change: tick.change, changePrice: tick.changePrice, previousClose: tick.previousClose, asOf: tick.asOf } : quote;
  });
  const layout = fitBoard(size.width, size.height, graph, largeText, quotes.length || 200);
  const pageCount = Math.max(1, Math.ceil(quotes.length / layout.capacity));
  const currentPage = Math.min(page, pageCount - 1);
  const offset = currentPage * layout.capacity;
  const visible = quotes.slice(offset, offset + layout.capacity);
  const codes = graph ? visible.map((quote) => symbolKey({ market: quote.market ?? market, chartCode: quote.chartCode })).join(',') : '';
  const liveCodes = visible.filter((quote) => (quote.marketStatus ?? payload?.marketStatus) === 'OPEN').map((quote) => symbolKey({ market: quote.market ?? market, chartCode: quote.chartCode })).join(',');

  useEffect(() => {
    if (provider !== 'kis' || !autoRefresh || !liveCodes || !size.width || payload?.marketStatus !== 'OPEN') return;
    let streams: EventSource[] = [];
    const statuses = new Map<string, LiveStatus>();
    const start = () => {
      streams.forEach((stream) => stream.close()); streams = []; statuses.clear();
      if (document.hidden) return;
      const groups = new Map<string, string[]>();
      for (const key of liveCodes.split(',')) { const [exchange, code] = key.split(':'); groups.set(exchange, [...(groups.get(exchange) ?? []), code]); }
      for (const [exchange, symbols] of groups) {
      const stream = new EventSource(`/api/live?market=${exchange}&codes=${encodeURIComponent(symbols.join(','))}`);
      streams.push(stream);
      stream.addEventListener('status', (event) => {
        try {
          statuses.set(exchange, JSON.parse(event.data) as LiveStatus);
          const values = [...statuses.values()];
          setLiveStatus({ state: values.some((value) => value.state === 'connected') ? 'connected' : 'connecting', subscribed: values.reduce((sum, value) => sum + value.subscribed, 0), requested: liveCodes.split(',').length });
        } catch { /* Wait for a valid relay event. */ }
      });
      stream.addEventListener('quote', (event) => {
        try {
          const tick = JSON.parse(event.data) as LiveTick;
          if (tick.market !== exchange || !Number.isFinite(tick.price) || tick.price <= 0 || !symbols.includes(tick.code)) return;
          setLiveTicks((current) => current[tick.code] && Date.parse(current[tick.code].asOf) > Date.parse(tick.asOf) ? current : { ...current, [tick.code]: tick });
        } catch { /* Keep the last received quote. */ }
      });
      stream.onerror = () => setLiveStatus({ state: 'reconnecting', subscribed: 0, requested: liveCodes.split(',').length });
      }
    };
    start();
    document.addEventListener('visibilitychange', start);
    return () => { streams.forEach((stream) => stream.close()); document.removeEventListener('visibilitychange', start); };
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
        const symbols = codes.split(','), failures: Record<string, string> = {};
        // Sequential 32-stock batches bound serverless fan-out as density grows.
        for (let offset = 0; offset < symbols.length; offset += 32) {
        const response = await fetch(`/api/chart?symbols=${encodeURIComponent(symbols.slice(offset, offset + 32).join(','))}&kind=minutes`, { signal: controller.signal });
        if (!response.ok) throw new Error('차트 조회 실패');
        const result = await response.json() as { series: Record<string, MinuteSeries>; errors: Record<string, string> };
        if (!controller.signal.aborted) {
          setSeries((current) => ({ ...current, ...result.series }));
          Object.assign(failures, result.errors);
        }
        }
        if (!controller.signal.aborted) setChartErrors(failures);
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
      {!quotes.length ? <output className="board-empty">{error ?? (watch ? '위 검색창에서 한국·미국 관심종목을 추가하세요.' : `${marketLabel(market)} 시세를 불러오고 있습니다.`)}</output> : graph ?
        <div className="graph-grid" style={{ gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${layout.rows}, ${Math.max(1, layout.rowHeight - 1)}px)` }}>
          {visible.map((quote, index) => {
            const exchange = quote.market ?? market, key = symbolKey({ market: exchange, chartCode: quote.chartCode });
            return <div className={`graph-slot ${watch ? 'watch-slot' : ''}`} key={key}>
              <a className="graph-card" href={stockUrl(quote, exchange)} target="_blank" rel="noopener noreferrer" aria-label={`${quote.name} 네이버 증권 새 탭에서 보기`}>
              <div className="graph-identity"><strong title={quote.name}>{quote.name}</strong><span>{offset + index + 1} · {quote.code}{watch ? ' · 분봉' : ''}</span></div>
              <Sparkline series={series[key]} tick={provider === 'kis' && quote.marketStatus === 'OPEN' && autoRefresh ? liveTicks[quote.chartCode] : undefined} name={quote.name} now={now} />
              <div className="graph-price"><Price quote={quote} market={exchange} />{quote.pending ? <span className="price-flat">수신 대기</span> : <Change value={quote.change} />}</div>
              {chartErrors[key] && <span className="chart-error">{chartErrors[key]}</span>}
              </a>
              {onRemove && <Button variant="ghost" size="icon" className="stock-remove" aria-label={`${quote.name} 관심종목 삭제`} title="관심종목 삭제" onClick={() => onRemove(quote)}><X /></Button>}
            </div>;
          })}
        </div> :
        <div className="quote-columns" style={{ gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))` }}>
          {columns.map((column, columnIndex) => <section className="quote-column" key={columnIndex} tabIndex={0} aria-label={`${market} ${columnIndex + 1}열 시세 스크롤 영역`}>
            <Table className={`quote-table ${watch ? 'watch-quote-table' : ''}`}>
              <colgroup><col className="rank-col" /><col /><col className="price-col" /><col className="rate-col" />{onRemove && <col className="remove-col" />}</colgroup>
              <TableHeader><TableRow><TableHead scope="col">#</TableHead><TableHead scope="col">종목명</TableHead><TableHead scope="col">현재가</TableHead><TableHead scope="col">등락률</TableHead>{onRemove && <TableHead scope="col"><span className="sr-only">삭제</span></TableHead>}</TableRow></TableHeader>
              <TableBody>{column.map((quote, index) => <TableRow key={quote.code} style={{ height: layout.rowHeight }}>
                <TableCell className="rank">{offset + columnIndex * layout.rows + index + 1}</TableCell>
                <TableCell className="stock-name" title={`${quote.name} (${quote.code}) · ${quote.market} ${statusLabel(quote.marketStatus)} · ${quote.asOf} · 거래대금 ${quote.turnover}`}><a href={stockUrl(quote, quote.market ?? market)} target="_blank" rel="noopener noreferrer"><strong>{quote.name}</strong></a></TableCell>
                <TableCell><a href={stockUrl(quote, quote.market ?? market)} target="_blank" rel="noopener noreferrer" aria-label={`${quote.name} 현재가 상세 보기`}><Price quote={quote} market={quote.market ?? market} /></a></TableCell>
                <TableCell><a href={stockUrl(quote, quote.market ?? market)} target="_blank" rel="noopener noreferrer" aria-label={`${quote.name} 등락률 상세 보기`}>{quote.pending ? <span className="price-flat">—</span> : <Change value={quote.change} />}</a></TableCell>
                {onRemove && <TableCell className="stock-remove-cell"><Button variant="ghost" size="icon" className="stock-remove" aria-label={`${quote.name} 관심종목 삭제`} title="관심종목 삭제" onClick={() => onRemove(quote)}><X /></Button></TableCell>}
              </TableRow>)}</TableBody>
            </Table>
          </section>)}
        </div>}
    </div>
    <footer className="board-footer">
      <p className={error ? 'connection-error' : ''}>{error ?? (payload ? `${watch ? '관심종목 · 한국/미국 현지 정규장' : `${statusLabel(payload.marketStatus)} · ${payload.marketStatus === 'OPEN' ? '정규장 현재가' : '정규장 최종가격'} · ${asOf}${isUS(market) ? ' ET' : ''}`} · ${layout.columns}열${graph ? ' · 실제 분봉 · 전일 기준선 · Y축 자동' : ''}` : '네이버 증권 연결 중')}
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
  const [indexSeries, setIndexSeries] = useState<Record<string, MinuteSeries>>({});
  const [watchlist, setWatchlist] = useState<StockSelection[]>([]);
  const [watchLoaded, setWatchLoaded] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [watchQuotes, setWatchQuotes] = useState<Record<string, Quote>>({});
  const [watchError, setWatchError] = useState('');
  const inFlight = useRef(false);

  useEffect(() => {
    // eslint-disable-next-line react/react-compiler -- Read browser-only persistence after hydration, never during the server render.
    try { setWatchlist(restoreWatchlist(localStorage.getItem(WATCHLIST_KEY))); }
    catch { setStorageError('브라우저 저장소 사용 불가 · 이번 화면에서만 유지됩니다.'); }
    setWatchLoaded(true);
    const sync = (event: StorageEvent) => { if (event.key === WATCHLIST_KEY) setWatchlist(restoreWatchlist(event.newValue)); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  useEffect(() => {
    if (!watchLoaded) return;
    try { localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist)); }
    // eslint-disable-next-line react/react-compiler -- Surface a real external storage failure to the user.
    catch { setStorageError('브라우저 저장 실패 · 이번 화면에서만 유지됩니다.'); }
  }, [watchlist, watchLoaded]);
  const watchSymbols = watchlist.map(symbolKey).join(',');
  useEffect(() => {
    if (!watchSymbols) return;
    const controller = new AbortController();
    void (async () => {
      const symbols = watchSymbols.split(','); let failed = 0;
      try {
        for (let offset = 0; offset < symbols.length; offset += 32) {
          const response = await fetch(`/api/watchlist?symbols=${encodeURIComponent(symbols.slice(offset, offset + 32).join(','))}`, { signal: controller.signal });
          if (!response.ok) throw new Error('관심종목 연결 재시도 중 · 마지막 수신값 유지');
          const result = await response.json() as { quotes: Record<string, Quote>; errors: Record<string, string> };
          if (controller.signal.aborted) return;
          setWatchQuotes((current) => ({ ...current, ...result.quotes }));
          failed += Object.keys(result.errors).length;
        }
        setWatchError(failed ? `${failed}종목 시세 수신 실패 · 마지막 수신값 유지 / 미수신 종목은 위 목록에 표시` : '');
      } catch (error) { if (!controller.signal.aborted) setWatchError(error instanceof Error ? error.message : '관심종목 연결 실패'); }
    })();
    return () => controller.abort();
  }, [watchSymbols, now]);

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
      await Promise.all([...markets.map(async (market) => {
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
      }), (async () => {
        try {
          const response = await fetch('/api/index-chart', { signal: AbortSignal.timeout(15000) });
          if (!response.ok) return;
          const result = await response.json() as { series: Record<string, MinuteSeries> };
          setIndexSeries((current) => ({ ...current, ...result.series }));
        } catch { /* Keep the last real index trend; its timestamp remains in the tooltip. */ }
      })()]);
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
  // Keep unreceived stocks visible and removable, without displaying a made-up price.
  const savedQuotes: Quote[] = watchlist.map((item) => watchQuotes[symbolKey(item)] ?? {
    ...item, pending: true, price: 0, previousClose: 0, change: 0, changePrice: 0, turnover: '—', asOf: '',
  });
  const watchPayload: MarketPayload = {
    stocks: savedQuotes, indices: [], marketStatus: savedQuotes.some((quote) => quote.marketStatus === 'OPEN') ? 'OPEN' : 'CLOSE',
    asOf: savedQuotes.reduce((latest, quote) => quote.asOf > latest ? quote.asOf : latest, ''), source: '네이버 증권',
  };

  return <main className={`terminal-shell ${largeText ? 'large-text' : 'compact'}`}>
    <Tabs value={tab} onValueChange={(value) => setTab(String(value))} className="market-tabs">
    <header className="terminal-header">
      <h1 className="brand-lockup">STOCK<span>11</span></h1>
      <TabsList aria-label="시장 보기 선택" className="market-tab-list">
        {views.map((view) => <TabsTrigger key={view.value} value={view.value}>{view.label}</TabsTrigger>)}
        <TabsTrigger value="watchlist">관심종목</TabsTrigger>
        <TabsTrigger value="watchlist-chart">관심종목 차트</TabsTrigger>
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
            <Sparkline mini series={indexSeries[label]} name={label} now={now} />
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
      {['watchlist', 'watchlist-chart'].map((value) => <TabsContent key={value} value={value} className="market-panel watch-panel">
        <WatchlistToolbar items={watchlist} onChange={setWatchlist} storageError={storageError} />
        <Board market="KOSPI" graph={value.endsWith('-chart')} watch onRemove={(quote) => setWatchlist((items) => items.filter((item) => item.chartCode !== quote.chartCode))} payload={watchPayload} largeText={largeText} autoRefresh={autoRefresh} error={watchlist.length ? watchError || (savedQuotes.length ? undefined : '관심종목 시세 수신 중…') : undefined} now={now} provider={provider} />
      </TabsContent>)}
    </Tabs>
  </main>;
}
