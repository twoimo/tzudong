"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { buildHomeAuthLoginPath, getSafeAuthNextPath, isAdminAuthNextPath } from '@/lib/auth/auth-redirect';
import { completeBrowserOAuthCallback } from '@/lib/auth/browser-oauth-commit';
import { Button } from '@/components/ui/button';

export default function AuthCompletePage() {
  const [failed, setFailed] = useState(false);
  const [retryPath, setRetryPath] = useState('/?auth=login');
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    // React's development effect replay can clean up before this work starts.
    // Never exchange a one-use code twice because an effect was replayed.
    queueMicrotask(() => {
      if (!active) return;
      const query = new URLSearchParams(window.location.search);
      const code = query.get('code');
      const next = getSafeAuthNextPath(query.get('next'));
      setRetryPath(buildHomeAuthLoginPath({ reason: isAdminAuthNextPath(next) ? 'admin' : 'mypage', next }));
      window.history.replaceState(window.history.state, '', '/auth/complete');
      if (query.getAll('code').length !== 1 || query.getAll('next').length > 1
        || !code || code.length > 2048 || /[\u0000-\u0020]/.test(code) || window.location.hash) {
        setFailed(true);
        return;
      }
      void completeBrowserOAuthCallback(code, next, controller.signal)
        .then(next => { if (active) window.location.replace(next); })
        .catch(() => { if (active) setFailed(true); });
    });
    return () => { active = false; controller.abort(); };
  }, []);

  return <main className="flex min-h-dvh items-center justify-center bg-background px-6">
    <section className="max-w-sm space-y-4 text-center" aria-live="polite">
      <h1 className="text-xl font-semibold">{failed ? '로그인을 완료하지 못했어요' : '로그인 확인 중이에요'}</h1>
      <p className="text-sm text-muted-foreground">{failed ? '다시 로그인해 주세요.' : '잠시만 기다려 주세요.'}</p>
      {failed && <Button asChild><Link href={retryPath}>다시 로그인</Link></Button>}
    </section>
  </main>;
}
