'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { applyOperation, emptyProfile, restoreProfile, type Profile, type ProfileOperation } from '@/lib/profile';
import { apiPath } from '@/lib/base-path';

type Pending = { id: string; operation: ProfileOperation };
export const PROFILE_CACHE_KEY = 'stock11.server-profile.v1';
const cacheProfile = (profile: Profile) => { try { window.localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile)); } catch { /* Server remains authoritative when browser caching is blocked. */ } };
export function useServerProfile() {
  const [phase, setPhase] = useState<'checking' | 'local' | 'locked' | 'ready' | 'cached' | 'error'>('checking');
  const [profile, setProfile] = useState<Profile>(emptyProfile);
  const [message, setMessage] = useState('');
  const [location, setLocation] = useState('서버');
  const [saving, setSaving] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  const confirmed = useRef<Profile>(emptyProfile());
  const pending = useRef<Pending[]>([]);
  const busy = useRef(false), epoch = useRef(0);
  const publish = useCallback(() => {
    let next = confirmed.current;
    for (const item of pending.current) next = applyOperation(next, item.operation);
    setProfile(next); setUnsaved(pending.current.length > 0);
  }, []);
  const lock = useCallback(() => {
    epoch.current++; pending.current = []; confirmed.current = emptyProfile();
    busy.current = false; setSaving(false); setUnsaved(false); setProfile(emptyProfile()); setPhase('locked');
    try { window.localStorage.removeItem(PROFILE_CACHE_KEY); } catch { /* No server credentials are cached. */ }
  }, []);
  const refresh = useCallback(async () => {
    if (busy.current || pending.current.length) return;
    const generation = epoch.current;
    try {
      const response = await fetch(apiPath('/api/session'), { cache: 'no-store', signal: AbortSignal.timeout(30000) });
      const session = await response.json();
      if (generation !== epoch.current) return;
      if (!response.ok) throw new Error(session.error ?? '서버 저장 연결 실패');
      if (!session.enabled) { setPhase('local'); setMessage(''); return; }
      setLocation(session.location ?? '서버');
      if (!session.authenticated) { lock(); return; }
      const result = await fetch(apiPath('/api/profile'), { cache: 'no-store', signal: AbortSignal.timeout(30000) });
      const data = await result.json();
      if (generation !== epoch.current || busy.current || pending.current.length) return;
      if (result.status === 401) { lock(); return; }
      if (!result.ok) throw new Error(data.error ?? '서버 기록을 불러오지 못했습니다.');
      const restored = restoreProfile(data.profile);
      if (!restored) throw new Error('서버 기록 형식 오류');
      if (restored.revision >= confirmed.current.revision) confirmed.current = restored;
      cacheProfile(confirmed.current);
      publish(); setPhase('ready'); setMessage('');
    } catch (error) {
      if (generation !== epoch.current) return;
      let cached: Profile | null = null;
      try { cached = restoreProfile(JSON.parse(window.localStorage.getItem(PROFILE_CACHE_KEY) ?? 'null')); } catch { /* Ignore a corrupt cache. */ }
      if (!pending.current.length && cached) {
        confirmed.current = cached; setProfile(cached); setPhase('cached');
      }
      // A temporary SQLite or network delay is retried automatically. Keep the dashboard usable
      // and avoid replacing it with a stale-connection warning while the authenticated session remains valid.
      setMessage('');
      setPhase((current) => current === 'checking' ? 'cached' : current);
    }
  }, [lock, publish]);
  useEffect(() => {
    // eslint-disable-next-line react/react-compiler -- Initial authentication and profile hydration use external server APIs.
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 10000);
    const resume = () => { if (!document.hidden) void refresh(); };
    window.addEventListener('focus', resume); document.addEventListener('visibilitychange', resume);
    const generation = epoch;
    return () => { generation.current++; window.clearInterval(timer); window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', resume); };
  }, [refresh]);
  const flush = async () => {
    if (busy.current || !pending.current.length) return;
    busy.current = true; setSaving(true); setMessage('');
    const generation = epoch.current;
    try {
      while (pending.current.length) {
        const item = pending.current[0];
        const response = await fetch(apiPath('/api/profile'), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item), signal: AbortSignal.timeout(30000) });
        const data = await response.json();
        if (generation !== epoch.current) return;
        if (response.status === 401) { lock(); setMessage('로그인이 만료됐습니다. 미저장 변경은 다시 입력해 주세요.'); return; }
        if (!response.ok) {
          if (response.status === 409 || response.status === 400) {
            pending.current = []; publish();
            throw new Error(`${data.error} 최신 기록을 다시 불러와 주세요.`);
          }
          throw new Error('서버 저장 실패 · 미저장 변경이 있습니다. 연결 후 다시 저장해 주세요.');
        }
        const restored = restoreProfile(data.profile);
        if (!restored) throw new Error('서버 기록 형식 오류');
        confirmed.current = restored; cacheProfile(restored); pending.current.shift(); publish();
      }
    } catch (error) {
      if (generation === epoch.current) setMessage(error instanceof Error ? error.message : '서버 저장 실패');
    } finally {
      if (generation === epoch.current) { busy.current = false; setSaving(false); setUnsaved(pending.current.length > 0); }
    }
  };
  const send = (operation: ProfileOperation) => {
    if (phase !== 'ready') { setMessage('로그인 후 서버 기록을 불러와 주세요.'); return; }
    try { applyOperation(profile, operation); }
    catch (error) { setMessage(error instanceof Error ? error.message : '변경할 수 없습니다.'); return; }
    pending.current.push({ id: crypto.randomUUID(), operation }); publish();
    if (!message) void flush();
  };
  const login = async (password: string) => {
    const response = await fetch(apiPath('/api/session'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }), signal: AbortSignal.timeout(30000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? '로그인 실패');
    epoch.current++; await refresh(); window.dispatchEvent(new window.Event('stock11-session-changed'));
  };
  const logout = async () => {
    if (pending.current.length) throw new Error('미저장 변경을 먼저 저장해 주세요.');
    const response = await fetch(apiPath('/api/session'), { method: 'DELETE', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('로그아웃 실패 · 다시 시도해 주세요.');
    lock(); setMessage(''); window.dispatchEvent(new window.Event('stock11-session-changed'));
  };
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (pending.current.length) event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  return { phase, enabled: phase !== 'local', profile, location, saving, unsaved, message, send, login, logout, refresh, retry: flush };
}
