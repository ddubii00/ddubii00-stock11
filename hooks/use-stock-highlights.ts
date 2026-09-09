'use client';
import { useEffect, useRef, useState } from 'react';
import { HIGHLIGHTS_KEY, restoreHighlights, type HighlightColor } from '@/lib/stock-highlights';

export function useStockHighlights() {
  const [highlighted, setHighlighted] = useState<Map<string, HighlightColor>>(new Map());
  const [highlightStorageError, setError] = useState('');
  const current = useRef(new Map<string, HighlightColor>());
  const storageHealthy = useRef(true);
  useEffect(() => {
    const read = () => {
      try {
        current.current = restoreHighlights(window.localStorage.getItem(HIGHLIGHTS_KEY));
        storageHealthy.current = true;
        setHighlighted(current.current);
        setError('');
      } catch {
        storageHealthy.current = false;
        setError('배경색 저장소 사용 불가 · 이번 화면에서만 유지됩니다.');
      }
    };
    // eslint-disable-next-line react/react-compiler -- Hydrate browser preferences after SSR; never overwrite storage with the initial empty state.
    read();
    const sync = (event: StorageEvent) => {
      if (event.key !== null && event.key !== HIGHLIGHTS_KEY) return;
      try { if (event.storageArea !== window.localStorage) return; } catch { return; }
      // Read the latest value, not an older queued event; do not write it back.
      read();
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  const onHighlight = (key: string, color?: HighlightColor) => {
    let next = new Map(current.current);
    if (storageHealthy.current) {
      try { next = restoreHighlights(window.localStorage.getItem(HIGHLIGHTS_KEY)); }
      catch { storageHealthy.current = false; }
    }
    if (color) next.set(key, color); else next.delete(key);
    current.current = next;
    setHighlighted(next);
    // Persist in the interaction, outside React state updaters/effects. This
    // preserves immediate reloads and avoids StrictMode or cross-tab write loops.
    try {
      window.localStorage.setItem(HIGHLIGHTS_KEY, JSON.stringify([...next]));
      storageHealthy.current = true;
      setError('');
    } catch {
      storageHealthy.current = false;
      setError('배경색 저장 실패 · 이번 화면에서만 유지됩니다.');
    }
  };
  return { highlighted, onHighlight, highlightStorageError };
}
