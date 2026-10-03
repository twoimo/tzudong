'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { Sentry.captureException(error); }, [error]);
  return (
    <html lang="ko">
      <body style={{ margin: 0, minHeight: '100vh', display: 'grid', placeItems: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <main style={{ textAlign: 'center', padding: 24 }}>
          <h1 style={{ fontSize: 20 }}>문제가 발생했습니다</h1>
          <button type="button" onClick={reset} style={{ padding: '10px 18px', cursor: 'pointer' }}>다시 시도</button>
        </main>
      </body>
    </html>
  );
}
