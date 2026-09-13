'use client';

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiPath } from '@/lib/base-path';

type SessionState = { enabled?: boolean; authenticated?: boolean; error?: string };

export function SiteAccessGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<'checking' | 'locked' | 'ready' | 'error'>('checking');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const check = useCallback(async () => {
    try {
      const response = await fetch(apiPath('/api/session'), { cache: 'no-store', signal: AbortSignal.timeout(30000) });
      const data = await response.json() as SessionState;
      if (!response.ok) throw new Error(data.error || '접속 인증 상태를 확인하지 못했습니다.');
      if (!data.enabled) { setPhase('error'); setMessage('서버 접속 암호 설정이 필요합니다.'); return; }
      setMessage(''); setPhase(data.authenticated ? 'ready' : 'locked');
    } catch (error) {
      setPhase('error'); setMessage(error instanceof Error ? error.message : '접속 인증 상태를 확인하지 못했습니다.');
    }
  }, []);
  useEffect(() => {
    void check();
    const timer = window.setInterval(() => { if (!document.hidden) void check(); }, 60_000);
    const resume = () => { if (!document.hidden) void check(); };
    const changed = () => { void check(); };
    window.addEventListener('focus', resume);
    window.addEventListener('stock11-session-changed', changed);
    document.addEventListener('visibilitychange', resume);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', resume);
      window.removeEventListener('stock11-session-changed', changed);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [check]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true); setMessage('');
    try {
      const response = await fetch(apiPath('/api/session'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }), signal: AbortSignal.timeout(30000) });
      const data = await response.json() as SessionState;
      if (!response.ok) throw new Error(data.error || '접속 암호가 일치하지 않습니다.');
      setPassword(''); setPhase('ready'); window.dispatchEvent(new window.Event('stock11-session-changed'));
    } catch (error) { setMessage(error instanceof Error ? error.message : '로그인에 실패했습니다.'); }
    finally { setBusy(false); }
  };
  if (phase === 'ready') return <>{children}</>;
  return <main className="site-access-shell"><section className="site-access-card">
    <div className="site-access-brand">STOCK<span>11</span></div>
    <p className="site-access-description">이 기기에서 처음 접속할 때 암호를 입력하세요. 인증 쿠키가 유지되는 동안 다시 묻지 않습니다.</p>
    {phase === 'checking' ? <p className="site-access-checking">접속 권한 확인 중...</p> : <form onSubmit={submit} className="site-access-form">
      <label htmlFor="site-password">접속 암호</label>
      <Input id="site-password" type="password" inputMode="numeric" autoComplete="current-password" value={password} maxLength={256} onChange={(event) => setPassword(event.target.value)} autoFocus disabled={busy || phase === 'error'} />
      <Button type="submit" disabled={busy || !password || phase === 'error'}>{busy ? '확인 중...' : '접속'}</Button>
      {phase === 'error' && <Button type="button" variant="outline" onClick={() => { setPhase('checking'); void check(); }}>다시 확인</Button>}
    </form>}
    {message && <output className="connection-error site-access-error">{message}</output>}
  </section></main>;
}
