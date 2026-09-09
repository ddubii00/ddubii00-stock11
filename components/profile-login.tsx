'use client';
import { useState, type SyntheticEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import type { useServerProfile } from '@/hooks/use-server-profile';
import type { ProfileOperation } from '@/lib/profile';

export function ProfileLogin({ sync, localImport }: { sync: ReturnType<typeof useServerProfile>; localImport: Extract<ProfileOperation, { type: 'import' }> }) {
  const [open, setOpen] = useState(false), [password, setPassword] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError('');
    try { await sync.login(password); setOpen(false); }
    catch (error) { setError(error instanceof Error ? error.message : '로그인 실패'); }
    finally { setPassword(''); setBusy(false); }
  };
  return <>
    <Button variant="ghost" className="profile-login-button" onClick={() => setOpen(true)} title={sync.profile.updatedAt ?? '관심종목·배경색 서버 저장'}>
      {sync.phase === 'ready' ? sync.saving ? '저장 중…' : sync.unsaved ? '미저장' : '서버 저장 ✓' : sync.phase === 'checking' ? '저장 확인…' : sync.phase === 'local' ? '로컬 저장' : '로그인'}
    </Button>
    <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) { setPassword(''); setError(''); } }}>
      <DialogContent>
        <DialogHeader><DialogTitle>관심종목 · 배경색 저장</DialogTitle><DialogDescription>{sync.enabled ? `${sync.location}에 저장합니다. 같은 사용자 설정으로 로그인하면 다른 컴퓨터에서도 불러옵니다.` : '서버 저장 또는 로그인 비밀번호가 아직 설정되지 않았습니다. 현재는 이 브라우저에만 저장합니다.'}</DialogDescription></DialogHeader>
        {sync.phase === 'ready' ? <div className="profile-account">
          <p>{sync.profile.updatedAt ? `마지막 저장: ${new Date(sync.profile.updatedAt).toLocaleString('ko-KR')}` : '저장된 서버 기록이 없습니다.'}</p>
          {sync.profile.revision === 0 && !sync.unsaved && (localImport.watchlist.length > 0 || localImport.highlights.length > 0) && <Button onClick={() => sync.send(localImport)}>이 브라우저 기록 가져오기</Button>}
          <Button variant="outline" disabled={sync.saving || sync.unsaved || busy} onClick={() => { setBusy(true); void sync.logout().catch((error: Error) => setError(error.message)).finally(() => setBusy(false)); }}>로그아웃</Button>
        </div> : sync.enabled && <form onSubmit={(event) => void submit(event)} className="profile-account">
          <label htmlFor="profile-password">비밀번호</label><Input id="profile-password" type="password" autoComplete="current-password" value={password} maxLength={256} onChange={(event) => setPassword(event.target.value)} required disabled={busy} />
          <Button type="submit" disabled={busy || !password}>{busy ? '로그인 중…' : '로그인'}</Button>
        </form>}
        {(error || sync.message) && <output className="connection-error">{error || sync.message}</output>}
      </DialogContent>
    </Dialog>
  </>;
}
