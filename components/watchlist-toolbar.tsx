'use client';
import { useEffect, useState } from 'react';
import { Combobox, ComboboxInput, ComboboxContent, ComboboxList, ComboboxItem } from '@/components/ui/combobox';
import { symbolKey } from '@/lib/watchlist';
import type { StockSelection } from '@/lib/market-types';

export function WatchlistToolbar({ items, onChange, storageError }: {
  items: StockSelection[]; onChange: (items: StockSelection[]) => void; storageError: string;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StockSelection[]>([]);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('종목명·코드 검색 · ↑↓ 선택 / Enter 추가');
  useEffect(() => {
    if (!query.trim()) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal });
        if (!response.ok) throw new Error('검색 연결 실패 · 다시 입력해 주세요.');
        const data = await response.json() as { items: StockSelection[] };
        if (controller.signal.aborted) return;
        setResults(data.items);
        setMessage(data.items.length ? `${data.items.length}개 검색 결과 · ↑↓ 선택 / Enter 추가` : '검색 결과 없음 · 영문명이나 종목코드로도 검색해 보세요.');
      } catch (error) {
        if (!controller.signal.aborted) { setResults([]); setMessage(error instanceof Error ? error.message : '검색 실패'); }
      }
    }, 250);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query]);
  const add = (item: StockSelection | null) => {
    if (!item) return;
    const duplicate = items.some((existing) => symbolKey(existing) === symbolKey(item));
    if (!duplicate && items.length < 200) onChange([...items, item]);
    setMessage(duplicate ? `${item.name}은 이미 등록되어 있습니다.` : items.length >= 200 ? '관심종목은 최대 200개입니다.' : `${item.name} 추가됨 · 이 브라우저에 저장`);
    setQuery(''); setResults([]); setOpen(false);
  };
  return <div className="watch-toolbar">
    <div className="watch-search-row">
      <Combobox items={results} filter={null} value={null} inputValue={query} open={open} onOpenChange={setOpen}
        onInputValueChange={(value, details) => { if (details.reason === 'item-press') return; setQuery(value); setResults([]); setMessage(value.trim() ? '검색 중…' : '종목명·코드 검색 · ↑↓ 선택 / Enter 추가'); }}
        onValueChange={add} itemToStringLabel={(item: StockSelection) => item.name} autoHighlight>
        <ComboboxInput className="watch-search" placeholder="한국·미국 종목 추가 (삼성, 애플, AAPL…)" aria-label="관심종목 검색" showTrigger={false} maxLength={60} />
        <ComboboxContent className="watch-results">
          <ComboboxList>{(item: StockSelection) => <ComboboxItem key={symbolKey(item)} value={item}>
            <strong>{item.name}</strong><span>{item.code} · {item.market}</span>
          </ComboboxItem>}</ComboboxList>
          {!results.length && <p className="search-message">{message}</p>}
        </ComboboxContent>
      </Combobox>
      <span className="watch-count">{items.length}/200</span>
      <output className="watch-message" aria-live="polite">{storageError || message}</output>
    </div>
  </div>;
}
