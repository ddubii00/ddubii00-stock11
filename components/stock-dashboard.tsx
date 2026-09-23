'use client';
/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- Independently scrolling stock tables need keyboard focus for arrow-key scrolling. */

import { useCallback, useEffect, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { ChevronLeft, ChevronRight, Expand, Pause, Play, RefreshCw, Type, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination, PaginationContent, PaginationItem } from '@/components/ui/pagination';
import { fitBoard } from '@/lib/board-layout';
import { apiPath } from '@/lib/base-path';
import { sessionFor } from '@/lib/chart-model';
import { Sparkline, type LiveTick } from '@/components/stock-charts';
import { WatchlistToolbar } from '@/components/watchlist-toolbar';
import { preserveSavedName, reorderWatchlist, restoreWatchlist, symbolKey, WATCHLIST_KEY } from '@/lib/watchlist';
import { stockUrl } from '@/lib/stock-links';
import { useStockHighlights } from '@/hooks/use-stock-highlights';
import { useServerProfile } from '@/hooks/use-server-profile';
import { ProfileLogin } from '@/components/profile-login';
import type { HighlightColor } from '@/lib/stock-highlights';
import { profileWatchlists, type TextScale, type WatchlistId } from '@/lib/profile';
import type { IndexQuote, Market, MarketPayload, MinuteSeries, Quote, StockSelection } from '@/lib/market-types';
import type { CoreSignal } from '@/lib/core-signal';

const markets: Market[] = ['KOSPI', 'KOSDAQ', 'NASDAQ', 'SP500'];
const marketLabel = (market: Market) => market === 'SP500' ? 'S&P500' : market;
const isUS = (market: Market) => market !== 'KOSPI' && market !== 'KOSDAQ';
const views = markets.flatMap((market) => [
  { value: market.toLowerCase(), market, graph: false, label: marketLabel(market) },
  { value: `${market.toLowerCase()}-chart`, market, graph: true, label: `${marketLabel(market)} 차트` },
]);
const watchViews = ([0, 1, 2, 3] as WatchlistId[]).flatMap((list) => [
  { value: list === 0 ? 'watchlist' : `watchlist${list + 1}`, list, graph: false, label: list === 0 ? '관심' : `관심${list + 1}` },
  { value: list === 0 ? 'watchlist-chart' : `watchlist${list + 1}-chart`, list, graph: true, label: list === 0 ? '관심 차트' : `관심${list + 1} 차트` },
]);
const textScaleCycle: TextScale[] = [-1, 0, 1, 2, 3, 4, 6];
const tone = (change: number) => change > 0 ? 'price-up' : change < 0 ? 'price-down' : 'price-flat';
const formatted = (value: number, market: Market) => value.toLocaleString('en-US', {
  minimumFractionDigits: isUS(market) ? 2 : 0, maximumFractionDigits: isUS(market) ? 2 : 0,
});
const statusLabel = (status?: string) => !status ? '연결 중' : status === 'OPEN' ? '장중' : status === 'PRE' ? '장전' : status === 'AFTER' ? '장후' : '장종료';
const REFRESH_MS = 30_000;
type LiveStatus = { state: string; subscribed: number; requested: number };
const domesticMarket = (market: Market) => market === 'KOSPI' || market === 'KOSDAQ';

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

export function Board({ market, graph, payload, largeText, textScale = largeText ? 1 : 0, autoRefresh, error, now, provider, afterMarket = false, watch = false, onRemove, onReorder, highlighted, onHighlight, signals }: {
  market: Market; graph: boolean; payload?: MarketPayload; largeText: boolean; textScale?: TextScale;
  autoRefresh: boolean; error?: string; now: number; provider: 'naver' | 'kis';
  afterMarket?: boolean;
  watch?: boolean; onRemove?: (quote: Quote) => void;
  onReorder?: (source: string, target: string) => void;
  highlighted?: ReadonlyMap<string, HighlightColor>; onHighlight?: (key: string, color?: HighlightColor) => void; signals?: Record<string, CoreSignal>;
}) {
  const [localHighlights, setLocalHighlights] = useState<Map<string, HighlightColor>>(new Map());
  const selected = highlighted ?? localHighlights;
  const updateHighlight = onHighlight ?? ((key: string, color?: HighlightColor) => setLocalHighlights((current) => {
    const next = new Map(current);
    if (color) next.set(key, color); else next.delete(key);
    return next;
  }));
  const isHighlighted = (key: string) => selected.has(key);
  const clickOrigin = useRef<{ key: string; color?: HighlightColor } | null>(null);
  const highlightClick = (event: MouseEvent, key: string) => {
    if (event.detail > 1) return;
    // Remember the original color before the first click of a double-click.
    // This avoids timers and honors the OS's own double-click speed setting.
    clickOrigin.current = { key, color: selected.get(key) };
    updateHighlight(key, selected.has(key) ? undefined : 'yellow');
  };
  const highlightDoubleClick = (key: string) => {
    const original = clickOrigin.current?.key === key ? clickOrigin.current.color : selected.get(key);
    updateHighlight(key, original === 'red' ? undefined : 'red');
    clickOrigin.current = null;
  };
  const highlightLabel = '배경 표시';
  const highlightHint = '한 번 클릭: 노란색 · 더블클릭: 빨간색 · 표시된 배경을 한 번 더 클릭하면 해제';
  const dragSource = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [moveMessage, setMoveMessage] = useState('');
  const area = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [page, setPage] = useState(0);
  const [series, setSeries] = useState<Record<string, MinuteSeries>>({});
  const [chartErrors, setChartErrors] = useState<Record<string, string>>({});
  const [liveTicks, setLiveTicks] = useState<Record<string, LiveTick>>({});
  const [liveStatus, setLiveStatus] = useState<LiveStatus>({ state: 'connecting', subscribed: 0, requested: 0 });
  const quotes: Quote[] = (payload?.stocks ?? []).map((quote) => {
    const tick = liveTicks[quote.chartCode];
    const canApplyTick = (quote.marketStatus ?? payload?.marketStatus) === 'OPEN' || (afterMarket && (quote.marketStatus ?? payload?.marketStatus) === 'AFTER');
    const quoteTime = Date.parse(quote.asOf);
    // KRX2 intentionally uses regular KRX ticks until the after session starts,
    // then only its separate integrated tick stream.  Match the quote's
    // explicit session rather than treating every KRX2 value as after-market.
    const replacesFallback = !quote.priceSource || quote.priceSource === 'naver-fallback';
    return tick && provider === 'kis' && !domesticMarket(quote.market ?? market) && canApplyTick && (tick.priceSession ?? 'regular') === (quote.priceSession ?? 'regular') && (replacesFallback || !Number.isFinite(quoteTime) || Date.parse(tick.asOf) >= quoteTime)
      ? { ...quote, price: tick.price, change: tick.change, changePrice: tick.changePrice, previousClose: tick.previousClose, asOf: tick.asOf, ...(tick.volume ? { volume: tick.volume } : {}), priceSource: 'kis-live' } : quote;
  });
  const layout = fitBoard(size.width, size.height, graph, largeText, quotes.length || 200, textScale);
  const pageCount = Math.max(1, Math.ceil(quotes.length / layout.capacity));
  const currentPage = Math.min(page, pageCount - 1);
  const offset = currentPage * layout.capacity;
  const visible = quotes.slice(offset, offset + layout.capacity);
  // Watchlist rows place the delete control inside the sticky name cell so it
  // remains visible even when a narrow viewport hides trailing columns.
  const hasActions = Boolean(onRemove) && !watch;
  const quoteKey = (quote: Quote) => symbolKey({ market: quote.market ?? market, chartCode: quote.chartCode });
  const endDrag = () => { dragSource.current = null; setDropTarget(null); };
  const moveStock = (source: string, target: string) => {
    if (!onReorder || source === target) return;
    const from = quotes.find((quote) => quoteKey(quote) === source);
    const to = quotes.findIndex((quote) => quoteKey(quote) === target);
    if (!from || to < 0) return;
    onReorder(source, target);
    setMoveMessage(`${from.name} ${to + 1}번째로 이동했습니다.`);
  };
  const dropEvents = (key: string) => watch && onReorder ? {
    draggable: true,
    'data-reorder-key': key,
    onDragStart: (event: DragEvent) => {
      if ((event.target as Element).closest('a, .stock-remove')) {
        event.preventDefault();
        return;
      }
      dragSource.current = key;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', key);
      event.dataTransfer.setDragImage(event.currentTarget, 12, 12);
    },
    onDragEnd: endDrag,
    onDragOver: (event: DragEvent) => {
      if (!dragSource.current) return;
      event.preventDefault(); event.dataTransfer.dropEffect = 'move';
      setDropTarget(key);
    },
    onDragLeave: (event: DragEvent) => {
      if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropTarget((current) => current === key ? null : current);
    },
    onDrop: (event: DragEvent) => {
      if (!dragSource.current) return;
      event.preventDefault(); event.stopPropagation();
      moveStock(dragSource.current, key); endDrag();
    },
  } : {};
  const codes = graph ? visible.map((quote) => symbolKey({ market: quote.market ?? market, chartCode: quote.chartCode })).join(',') : '';
  const liveCodes = visible.filter((quote) => {
    const status = quote.marketStatus ?? payload?.marketStatus;
    return !domesticMarket(quote.market ?? market) && (status === 'OPEN' || (afterMarket && status === 'AFTER'));
  }).map((quote) => symbolKey({ market: quote.market ?? market, chartCode: quote.chartCode })).join(',');

  useEffect(() => {
    if (provider !== 'kis' || !autoRefresh || !liveCodes || !size.width || (payload?.marketStatus !== 'OPEN' && !(afterMarket && payload?.marketStatus === 'AFTER'))) return;
    let streams: EventSource[] = [];
    const statuses = new Map<string, LiveStatus>();
    const start = () => {
      streams.forEach((stream) => stream.close()); streams = []; statuses.clear();
      if (document.hidden) return;
      const groups = new Map<string, string[]>();
      for (const key of liveCodes.split(',')) { const [exchange, code] = key.split(':'); groups.set(exchange, [...(groups.get(exchange) ?? []), code]); }
      for (const [exchange, symbols] of groups) {
      const stream = new EventSource(`${apiPath('/api/live')}?market=${exchange}&codes=${encodeURIComponent(symbols.join(','))}${afterMarket && (exchange === 'KOSPI' || exchange === 'KOSDAQ') ? '&after=1' : ''}`);
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
  }, [provider, autoRefresh, liveCodes, market, size.width, payload?.marketStatus, afterMarket]);

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
        const response = await fetch(`${apiPath('/api/chart')}?symbols=${encodeURIComponent(symbols.slice(offset, offset + 32).join(','))}&kind=minutes${afterMarket ? '&after=1' : ''}`, { signal: controller.signal });
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
  }, [market, codes, autoRefresh, size.width, afterMarket]);

  const columns = Array.from({ length: layout.columns }, (_, column) => visible.slice(column * layout.rows, (column + 1) * layout.rows));
  const asOf = payload?.asOf ? new Date(payload.asOf).toLocaleString('ko-KR', {
    timeZone: sessionFor(market).timeZone, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }) : '';
  return <section className={`board-section ${watch ? 'watch-board' : ''} ${market === 'KOSPI' && graph && !watch ? 'kospi-chart-board' : ''}`}>
    {watch && <output className="sr-only">{moveMessage}</output>}
    <div ref={area} className={`board-viewport ${graph ? 'graph-viewport' : 'quotes-viewport'}`}>
      {!quotes.length ? <output className="board-empty">{error ?? (watch ? '위 검색창에서 한국·미국 관심종목을 추가하세요.' : `${marketLabel(market)} 시세를 불러오고 있습니다.`)}</output> : graph ?
        <div className="graph-grid" style={{ gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${layout.rows}, ${Math.max(1, layout.rowHeight - 1)}px)` }}>
          {visible.map((quote, index) => {
            const exchange = quote.market ?? market, key = symbolKey({ market: exchange, chartCode: quote.chartCode });
            return <div className={`graph-slot ${watch ? 'watch-slot' : ''}`} key={key} data-drop-target={dropTarget === key} {...dropEvents(key)} style={{ gridColumn: Math.floor(index / layout.rows) + 1, gridRow: index % layout.rows + 1 }}>
              <div className="graph-card" data-highlighted={isHighlighted(key)} data-highlight-color={selected.get(key)}>
              <Button variant="ghost" className="chart-highlight-toggle" aria-label={`${quote.name} ${highlightLabel}`} title={highlightHint} aria-pressed={isHighlighted(key)} onClick={(event) => highlightClick(event, key)} onDoubleClick={() => highlightDoubleClick(key)} />
              <div className="graph-identity"><a href={stockUrl(quote, exchange)} target="_blank" rel="noopener noreferrer" aria-label={`${quote.name} 네이버 증권 새 탭에서 보기`}><strong title={quote.name}>{quote.name}</strong></a>{signals?.[key] && <span className={`core-signal ${signals[key].action.toLowerCase()}`}>{signals[key].action === 'PARTIAL_BUY' ? '부분매수' : signals[key].action === 'PARTIAL_SELL' ? '부분매도' : '관망'} {signals[key].percentage}%</span>}<span>{offset + index + 1} · {quote.code}{watch ? ' · 분봉' : ''}</span></div>
              <Sparkline series={series[key]} tick={provider === 'kis' && !domesticMarket(exchange) && autoRefresh && (afterMarket ? quote.marketStatus === 'AFTER' : quote.marketStatus === 'OPEN') ? liveTicks[quote.chartCode] : undefined} name={quote.name} now={now} />
              <div className="graph-price"><Price quote={quote} market={exchange} />{quote.pending ? <span className="price-flat">수신 대기</span> : <Change value={quote.change} />}</div>
              {chartErrors[key] && <span className="chart-error">{chartErrors[key]}</span>}
              </div>
              {onRemove && <Button variant="ghost" size="icon" className="stock-remove" aria-label={`${quote.name} 관심종목 삭제`} title="관심종목 삭제" onClick={() => onRemove(quote)}><X /></Button>}
            </div>;
          })}
        </div> :
        <div className="quote-columns" style={{ gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))` }}>
          {columns.map((column, columnIndex) => <section className="quote-column" key={columnIndex} tabIndex={0} aria-label={`${market} ${columnIndex + 1}열 시세 스크롤 영역`}>
            <Table className={`quote-table ${watch ? 'watch-quote-table' : ''}`}>
              <colgroup><col className="rank-col" /><col /><col className="price-col" /><col className="rate-col" />{watch && <col className="volume-col" />}{hasActions && <col className="remove-col" />}</colgroup>
              <TableHeader><TableRow><TableHead scope="col">#</TableHead><TableHead scope="col">종목명</TableHead><TableHead scope="col">현재가</TableHead><TableHead scope="col">등락률</TableHead>{watch && <TableHead scope="col" className="volume-head">거래량</TableHead>}{hasActions && <TableHead scope="col"><span className="sr-only">관리</span></TableHead>}</TableRow></TableHeader>
              <TableBody>{column.map((quote, index) => {
                const key = symbolKey({ market: quote.market ?? market, chartCode: quote.chartCode });
                // The rank button provides keyboard access; the row extends its pointer hit area.
                return <TableRow key={key} style={{ height: layout.rowHeight }} data-highlighted={isHighlighted(key)} data-highlight-color={selected.get(key)} data-drop-target={dropTarget === key} {...dropEvents(key)} onClick={(event) => {
                  if (!(event.target as Element).closest('a, button')) highlightClick(event, key);
                }} onDoubleClick={(event) => {
                  if (!(event.target as Element).closest('a, button')) highlightDoubleClick(key);
                }}>
                <TableCell className="rank"><Button variant="ghost" className="rank-highlight-toggle" aria-label={`${quote.name} ${highlightLabel}`} title={highlightHint} aria-pressed={isHighlighted(key)} onClick={(event) => highlightClick(event, key)} onDoubleClick={() => highlightDoubleClick(key)}>{offset + columnIndex * layout.rows + index + 1}</Button></TableCell>
                <TableCell className="stock-name" title={`${quote.name} (${quote.code}) · ${quote.market} ${statusLabel(quote.marketStatus)} · ${quote.asOf} · 거래대금 ${quote.turnover}`}><a href={stockUrl(quote, quote.market ?? market)} target="_blank" rel="noopener noreferrer"><strong>{quote.name}</strong></a>{signals?.[key] && <span className={`core-signal ${signals[key].action.toLowerCase()}`}>{signals[key].action === 'PARTIAL_BUY' ? '부분매수' : signals[key].action === 'PARTIAL_SELL' ? '부분매도' : '관망'} {signals[key].percentage}%</span>}{watch && onRemove && <Button variant="ghost" size="icon" className="stock-remove" aria-label={`${quote.name} 관심종목 삭제`} title="관심종목 삭제" onClick={() => onRemove(quote)}><X /></Button>}</TableCell>
                <TableCell><Price quote={quote} market={quote.market ?? market} /></TableCell>
                <TableCell>{quote.pending ? <span className="price-flat">—</span> : <Change value={quote.change} />}</TableCell>
                {watch && <TableCell className="volume-cell">{quote.pending ? '—' : quote.volume ?? '—'}</TableCell>}
                {hasActions && <TableCell className="stock-remove-cell">{onRemove && <Button variant="ghost" size="icon" className="stock-remove" aria-label={`${quote.name} 관심종목 삭제`} title="관심종목 삭제" onClick={() => onRemove(quote)}><X /></Button>}</TableCell>}
              </TableRow>; })}</TableBody>
            </Table>
          </section>)}
        </div>}
    </div>
    <footer className="board-footer">
      <p className={error ? 'connection-error' : ''}>{error ?? (payload ? `${watch ? `관심종목 · 한국 ${afterMarket ? '장전·정규장·장후' : '정규장'}/미국 현지 정규장` : `${statusLabel(payload.marketStatus)} · ${payload.marketStatus === 'OPEN' ? '정규장 현재가' : payload.marketStatus === 'PRE' ? '장전 현재가' : payload.marketStatus === 'AFTER' ? '장후 현재가' : '최종가격'} · ${asOf}${isUS(market) ? ' ET' : ''}`} · ${layout.columns}열${graph ? ' · 실제 분봉 · 전일 기준선 · Y축 자동' : ''}` : '네이버 증권 연결 중')}
        {provider === 'kis' && autoRefresh && quotes.some((quote) => domesticMarket(quote.market ?? market)) && <span> · KIS REST · {quotes.filter((quote) => domesticMarket(quote.market ?? market)).length}종목 · {watch ? '2' : '3'}초 갱신</span>}
        {provider === 'kis' && autoRefresh && !quotes.some((quote) => domesticMarket(quote.market ?? market)) && payload?.marketStatus === 'OPEN' && <span> · {liveStatus.state === 'connected' && liveStatus.subscribed > 0 ? `KIS 구독 ${liveStatus.subscribed}/${liveStatus.requested || visible.length} · 미구독 30초` : 'KIS 연결 대기 · 30초 갱신'}</span>}
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
  const { highlighted: localHighlights, onHighlight: localOnHighlight, highlightStorageError } = useStockHighlights();
  const sync = useServerProfile();
  const highlighted = sync.enabled ? new Map(sync.profile.highlights) : localHighlights;
  const onHighlight = (key: string, color?: HighlightColor) => {
    if (sync.enabled) sync.send({ type: 'highlight', key, color: color ?? null }); else localOnHighlight(key, color);
  };
  const [data, setData] = useState<Partial<Record<Market, MarketPayload>>>({});
  const [indices, setIndices] = useState<IndexQuote[]>([]);
  const [errors, setErrors] = useState<Partial<Record<Market, string>>>({});
  const [krxMode, setKrxMode] = useState<'KRX' | 'KRX2'>('KRX');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [localTextScale, setLocalTextScale] = useState<TextScale>(1);
  const textScale = sync.enabled && (sync.phase === 'ready' || sync.phase === 'cached') ? sync.profile.settings.textScale : localTextScale;
  const largeText = textScale > 0;
  const cycleTextScale = () => {
    const next = textScaleCycle[(textScaleCycle.indexOf(textScale) + 1) % textScaleCycle.length];
    if (sync.enabled) sync.send({ type: 'settings', largeText: next > 0, textScale: next });
    else {
      setLocalTextScale(next);
      try {
        localStorage.setItem('stock11.text-scale.v1', JSON.stringify(next));
        localStorage.setItem('stock11.large-text.v1', JSON.stringify(next > 0));
      } catch { /* Browser preferences remain usable. */ }
    }
  };
  const [tab, setTab] = useState('kospi');
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState<'naver' | 'kis'>('naver');
  const [marketRefreshMs, setMarketRefreshMs] = useState(REFRESH_MS);
  const [watchRefreshMs, setWatchRefreshMs] = useState(REFRESH_MS);
  const [indexSeries, setIndexSeries] = useState<Record<string, MinuteSeries>>({});
  const [localWatchlists, setLocalWatchlists] = useState<[StockSelection[], StockSelection[], StockSelection[], StockSelection[]]>([[], [], [], []]);
  const dataRef = useRef(data);
  const tabRef = useRef(tab);
  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => { tabRef.current = tab; }, [tab]);
  const watchlists = sync.enabled ? profileWatchlists(sync.profile) : localWatchlists;
  const setWatchlist = (items: StockSelection[], list: WatchlistId = 0) => {
    const current = watchlists[list];
    if (!sync.enabled) { setLocalWatchlists((lists) => lists.map((old, index) => index === list ? items : old) as [StockSelection[], StockSelection[], StockSelection[], StockSelection[]]); return; }
    for (const item of items) if (!current.some((old) => symbolKey(old) === symbolKey(item))) sync.send({ type: 'add', item, list });
  };
  const removeWatch = (quote: Quote, list: WatchlistId = 0) => {
    const key = symbolKey({ market: quote.market ?? 'KOSPI', chartCode: quote.chartCode });
    if (sync.enabled) sync.send({ type: 'remove', key, list });
    else setLocalWatchlists((lists) => lists.map((items, index) => index === list ? items.filter((item) => symbolKey(item) !== key) : items) as [StockSelection[], StockSelection[], StockSelection[], StockSelection[]]);
  };
  const reorderWatch = (source: string, target: string, list: WatchlistId = 0) => {
    const current = watchlists[list];
    if (!sync.enabled) { setLocalWatchlists((lists) => lists.map((items, index) => index === list ? reorderWatchlist(items, source, target) : items) as [StockSelection[], StockSelection[], StockSelection[], StockSelection[]]); return; }
    const next = reorderWatchlist(current, source, target);
    const following = next[next.findIndex((item) => symbolKey(item) === source) + 1];
    sync.send({ type: 'move', key: source, before: following ? symbolKey(following) : null, list });
  };
  const [watchLoaded, setWatchLoaded] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [watchQuoteState, setWatchQuoteState] = useState<{ mode: 'KRX' | 'KRX2'; quotes: Record<string, Quote> }>({ mode: 'KRX', quotes: {} });
  const [watchError, setWatchError] = useState('');
  const [watchSignals, setWatchSignals] = useState<Record<string, CoreSignal>>({});
  const inFlight = useRef(false);
  const refreshQueued = useRef(false);
  const krxModeRef = useRef(krxMode);
  useEffect(() => { krxModeRef.current = krxMode; }, [krxMode]);

  useEffect(() => {
    try {
      const scale = Number(localStorage.getItem('stock11.text-scale.v1'));
      // eslint-disable-next-line react/react-compiler -- Restore browser-only text-size preference after hydration.
      if (Number.isInteger(scale) && (scale === -1 || (scale >= 0 && scale <= 4) || scale === 6)) setLocalTextScale(scale as TextScale);
      else {
        const saved = localStorage.getItem('stock11.large-text.v1');
        // eslint-disable-next-line react/react-compiler -- Migrate the previous boolean text preference.
        if (saved === 'true' || saved === 'false') setLocalTextScale(saved === 'true' ? 1 : 0);
      }
    } catch { /* Optional UI preference. */ }
    // eslint-disable-next-line react/react-compiler -- Read browser-only persistence after hydration, never during the server render.
    try {
      const keys = [WATCHLIST_KEY, 'stock11.watchlist2.v1', 'stock11.watchlist3.v1', 'stock11.watchlist4.v1'];
      setLocalWatchlists(keys.map((key) => restoreWatchlist(localStorage.getItem(key))) as [StockSelection[], StockSelection[], StockSelection[], StockSelection[]]);
    }
    catch { setStorageError('브라우저 저장소 사용 불가 · 이번 화면에서만 유지됩니다.'); }
    setWatchLoaded(true);
    const keys = new Set([WATCHLIST_KEY, 'stock11.watchlist2.v1', 'stock11.watchlist3.v1', 'stock11.watchlist4.v1']);
    const sync = (event: StorageEvent) => { if (event.key && keys.has(event.key)) setLocalWatchlists((lists) => lists.map((items, index) => index === [...keys].indexOf(event.key!) ? restoreWatchlist(event.newValue) : items) as [StockSelection[], StockSelection[], StockSelection[], StockSelection[]]); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  useEffect(() => {
    if (!watchLoaded) return;
    try {
      [WATCHLIST_KEY, 'stock11.watchlist2.v1', 'stock11.watchlist3.v1', 'stock11.watchlist4.v1'].forEach((key, index) => localStorage.setItem(key, JSON.stringify(localWatchlists[index])));
    }
    // eslint-disable-next-line react/react-compiler -- Surface a real external storage failure to the user.
    catch { setStorageError('브라우저 저장 실패 · 이번 화면에서만 유지됩니다.'); }
  }, [localWatchlists, watchLoaded]);
  const activeWatch = watchViews.find((view) => view.value === tab);
  const activeWatchItems = activeWatch ? watchlists[activeWatch.list] : [];
  const watchSymbols = activeWatchItems.map(symbolKey).filter((key, index, all) => all.indexOf(key) === index).join(',');
  useEffect(() => {
    if (!watchSymbols) return;
    let stopped = false, timer: number | undefined, controller: AbortController | undefined;
    const load = async () => {
      controller = new AbortController();
      let failed = 0;
      try {
        const after = krxMode === 'KRX2' ? '&after=1' : '';
        const response = await fetch(`${apiPath('/api/watchlist')}?symbols=${encodeURIComponent(watchSymbols)}${after}`, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('관심종목 연결 재시도 중 · 마지막 수신값 유지');
        const result = await response.json() as { quotes: Record<string, Quote>; errors: Record<string, string> };
        if (stopped || controller.signal.aborted) return;
        setWatchQuoteState((current) => ({ mode: krxMode, quotes: current.mode === krxMode ? { ...current.quotes, ...result.quotes } : result.quotes }));
        failed += Object.keys(result.errors).length;
        setWatchError(failed ? `${failed}종목 시세 수신 실패 · 마지막 수신값 유지 / 미수신 종목은 위 목록에 표시` : '');
      } catch (error) { if (!stopped && !controller.signal.aborted) setWatchError(error instanceof Error ? error.message : '관심종목 연결 실패'); }
      finally { if (!stopped && autoRefresh) timer = window.setTimeout(() => { void load(); }, watchRefreshMs); }
    };
    void load();
    return () => { stopped = true; if (timer) window.clearTimeout(timer); controller?.abort(); };
  }, [watchSymbols, krxMode, autoRefresh, watchRefreshMs]);

  useEffect(() => {
    if (!watchSymbols) { setWatchSignals({}); return; }
    const controller = new AbortController();
    void fetch(`${apiPath('/api/analyze')}?symbols=${encodeURIComponent(watchSymbols)}`, { signal: controller.signal, cache: 'no-store' }).then((response) => response.ok ? response.json() as Promise<{ signals: Record<string, CoreSignal> }> : Promise.reject(new Error('분석 대기'))).then((result) => { if (!controller.signal.aborted) setWatchSignals(result.signals); }).catch(() => { if (!controller.signal.aborted) setWatchSignals({}); });
    return () => controller.abort();
  }, [watchSymbols, now]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(apiPath('/api/runtime'), { signal: controller.signal }).then((response) => response.json() as Promise<{ provider: string; marketRefreshMs?: number; watchRefreshMs?: number }>).then((config) => {
      if (!controller.signal.aborted) {
        const kis = config.provider === 'kis';
        setProvider(kis ? 'kis' : 'naver');
        setMarketRefreshMs(kis && Number.isFinite(config.marketRefreshMs) ? config.marketRefreshMs! : REFRESH_MS);
        setWatchRefreshMs(kis && Number.isFinite(config.watchRefreshMs) ? config.watchRefreshMs! : REFRESH_MS);
      }
    }).catch(() => { /* The default 30-second provider remains available. */ });
    return () => controller.abort();
  }, []);

  const refresh = useCallback(async () => {
    if (inFlight.current) { refreshQueued.current = true; return; }
    inFlight.current = true;
    const requestedKrxMode = krxModeRef.current;
    setBusy(true);
    try {
      await Promise.all([...markets.map(async (market) => {
        try {
          const after = requestedKrxMode === 'KRX2' && (market === 'KOSPI' || market === 'KOSDAQ') ? '&after=1' : '';
          const active = views.find((view) => view.value === tabRef.current)?.market === market;
          const visible = active ? (dataRef.current[market]?.stocks ?? []).slice(0, 32).map((quote) => quote.chartCode).join(',') : '';
          const priority = active ? `&priority=active${visible ? `&visible=${encodeURIComponent(visible)}` : ''}` : '';
          const response = await fetch(`${apiPath('/api/market')}?market=${market}${market === 'KOSPI' ? '&indices=1' : ''}${after}${priority}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
          if (!response.ok) throw new Error('시세 연결 재시도 중 · 마지막 수신값 표시');
          const result = await response.json() as MarketPayload;
          if (!result.stocks?.length) throw new Error('시세 수신 대기');
          if (requestedKrxMode !== krxModeRef.current) return;
          setData((current) => ({ ...current, [market]: result }));
          setErrors((current) => ({ ...current, [market]: undefined }));
          if (result.indices?.length) setIndices(result.indices);
        } catch (error) {
          setErrors((current) => ({ ...current, [market]: error instanceof Error ? error.message : '시세 연결 재시도 중' }));
        }
      }), (async () => {
        try {
          const response = await fetch(apiPath('/api/index-chart'), { signal: AbortSignal.timeout(15000) });
          if (!response.ok) return;
          const result = await response.json() as { series: Record<string, MinuteSeries> };
          setIndexSeries((current) => ({ ...current, ...result.series }));
        } catch { /* Keep the last real index trend; its timestamp remains in the tooltip. */ }
      })()]);
    } finally {
      setNow(Date.now());
      setBusy(false);
      inFlight.current = false;
      if (refreshQueued.current) {
        refreshQueued.current = false;
        queueMicrotask(() => { void refresh(); });
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (!autoRefresh) return;
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, marketRefreshMs);
    const onVisibility = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisibility); };
  }, [autoRefresh, refresh, marketRefreshMs]);

  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { /* Fullscreen may be unavailable in an embedded preview. */ }
  };
  // Keep unreceived stocks visible and removable, without displaying a made-up price.
  const savedQuotesFor = (list: WatchlistId): Quote[] => watchlists[list].map((item) => {
    // Do not render the other mode's price while a newly selected source loads.
    const received = watchQuoteState.mode === krxMode ? watchQuoteState.quotes[symbolKey(item)] : undefined;
    return received ? preserveSavedName(item, received) : {
      ...item, pending: true, price: 0, previousClose: 0, change: 0, changePrice: 0, turnover: '—', volume: '—', asOf: '',
    };
  });
  const watchPayloadFor = (list: WatchlistId): MarketPayload => {
    const savedQuotes = savedQuotesFor(list);
    return { stocks: savedQuotes, indices: [], marketStatus: savedQuotes.some((quote) => quote.marketStatus === 'PRE') ? 'PRE' : savedQuotes.some((quote) => quote.marketStatus === 'OPEN') ? 'OPEN' : 'CLOSE',
      asOf: savedQuotes.reduce((latest, quote) => quote.asOf > latest ? quote.asOf : latest, ''), source: '네이버 증권' };
  };

  const textScaleClass = textScale === -1 ? 'small' : textScale === 6 ? 'xlarge' : textScale;
  return <main className={`terminal-shell text-size-${textScaleClass} ${largeText ? 'large-text' : 'compact'}`}>
    <Tabs value={tab} onValueChange={(value) => setTab(String(value))} className="market-tabs">
    <header className="terminal-header">
      <h1 className="brand-lockup">STOCK<span>11</span></h1>
      <TabsList aria-label="시장 보기 선택" className="market-tab-list">
        {views.map((view) => <TabsTrigger key={view.value} value={view.value}>{view.label}</TabsTrigger>)}
        {watchViews.map((view) => <TabsTrigger key={view.value} value={view.value}>{view.label}</TabsTrigger>)}
      </TabsList>
      <div className="session-badges">
        <div className="krx-mode-buttons" role="group" aria-label="한국 시장 시세 범위">
          <button type="button" className={krxMode === 'KRX' ? 'active' : ''} onClick={() => setKrxMode('KRX')} title="정규장 15:30까지">KRX</button>
          <button type="button" className={krxMode === 'KRX2' ? 'active' : ''} onClick={() => setKrxMode('KRX2')} title="장전 08:00–08:50 · 정규장 · 장후 16:00–20:00">KRX2</button>
        </div>
        <span className={data.KOSPI?.marketStatus === 'OPEN' || data.KOSPI?.marketStatus === 'PRE' || data.KOSPI?.marketStatus === 'AFTER' ? 'session-open' : ''}><i />{statusLabel(data.KOSPI?.marketStatus)}</span>
        <span className={data.NASDAQ?.marketStatus === 'OPEN' ? 'session-open' : ''}><i />미국 {statusLabel(data.NASDAQ?.marketStatus)}</span>
      </div>
      <div className="header-indices" aria-label="주요 시장 지수">
        {['KOSPI', 'KOSDAQ', 'USD/KRW', 'NASDAQ', 'S&P 500'].map((label) => {
          const item = indices.find((index) => index.label === label);
          return <div className="index-item" key={label} title={item?.asOf ? `${label} · ${new Date(item.asOf).toLocaleString('ko-KR')}` : `${label} 수신 대기`}>
            <div className="index-data">
              <span className="index-label">{label}</span>
              <strong className={item ? tone(item.change) : ''}>{item ? item.value.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—'}</strong>
              {item && <span className={`index-change ${tone(item.change)}`}>{item.change > 0 ? '+' : ''}{item.change.toFixed(1)}%</span>}
            </div>
            <Sparkline mini series={indexSeries[label]} name={label} now={now} />
          </div>;
        })}
      </div>
      <div className="header-actions">
        <ProfileLogin sync={sync} localImport={{ type: 'import', watchlist: localWatchlists[0], watchlists: localWatchlists, highlights: [...localHighlights], largeText: localTextScale > 0, textScale: localTextScale }} />
        <span className="refresh-status" title={provider === 'kis' ? '국내 시세는 KIS 멀티 REST 공유 캐시로 갱신합니다.' : '시세와 분봉을 30초마다 갱신합니다.'}><i className={autoRefresh ? 'on' : ''} />{autoRefresh ? provider === 'kis' ? 'KIS REST' : '30초' : '멈춤'}</span>
        <Button variant="ghost" size="icon" disabled={busy} onClick={() => void refresh()} aria-label="지금 새로고침" title="지금 새로고침"><RefreshCw className={busy ? 'refreshing' : ''} /></Button>
        <Button variant="ghost" size="icon" onClick={() => setAutoRefresh((value) => !value)} aria-label={autoRefresh ? '자동 갱신 멈춤' : '자동 갱신 시작'} title={autoRefresh ? '자동 갱신 멈춤' : '자동 갱신 시작'}>{autoRefresh ? <Pause /> : <Play />}</Button>
        <Button variant="ghost" size="icon" onClick={() => void fullscreen()} aria-label="전체 화면" title="전체 화면"><Expand /></Button>
        <Button variant="ghost" size="icon" onClick={cycleTextScale} aria-label={`글자 크기 전환 · 현재 ${textScaleCycle.indexOf(textScale) + 1}단계`} title={`글자 크기 ${textScaleCycle.indexOf(textScale) + 1}/7 · 누르면 다음 단계`}><Type /></Button>
      </div>
    </header>
      {!sync.enabled && highlightStorageError && <output className="connection-error">{highlightStorageError}</output>}
      {sync.message && <div className="profile-message"><output className="connection-error">{sync.message}</output><Button variant="ghost" onClick={() => void (sync.unsaved ? sync.retry() : sync.refresh())}>{sync.unsaved ? '다시 저장' : '다시 불러오기'}</Button></div>}
      {views.map((view) => <TabsContent key={view.value} value={view.value} className="market-panel">
        <Board {...view} highlighted={highlighted} onHighlight={onHighlight} payload={data[view.market]} largeText={largeText} textScale={textScale} autoRefresh={autoRefresh} error={errors[view.market]} now={now} provider={provider} afterMarket={krxMode === 'KRX2'} />
      </TabsContent>)}
      {watchViews.map((view) => <TabsContent key={view.value} value={view.value} className="market-panel watch-panel">
        <WatchlistToolbar items={watchlists[view.list]} onChange={(items) => setWatchlist(items, view.list)} disabled={sync.enabled && sync.phase !== 'ready'} storageError={sync.enabled ? sync.phase !== 'ready' ? '상단 로그인 후 관심종목을 불러오세요.' : '' : storageError} />
        <Board market="KOSPI" graph={view.graph} highlighted={highlighted} onHighlight={onHighlight} watch signals={view.list === 0 ? watchSignals : undefined} onReorder={(source, target) => reorderWatch(source, target, view.list)} onRemove={(quote) => removeWatch(quote, view.list)} payload={watchPayloadFor(view.list)} largeText={largeText} textScale={textScale} autoRefresh={autoRefresh} error={watchlists[view.list].length ? watchError || (savedQuotesFor(view.list).length ? undefined : '관심종목 시세 수신 중…') : sync.enabled && sync.phase !== 'ready' ? '상단 로그인 후 서버 기록을 불러오세요.' : undefined} now={now} provider={provider} afterMarket={krxMode === 'KRX2'} />
      </TabsContent>)}
    </Tabs>
  </main>;
}
