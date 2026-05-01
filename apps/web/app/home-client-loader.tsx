'use client';

import dynamic from 'next/dynamic';

const HomeClient = dynamic(() => import('./home-client'), {
    ssr: false,
    loading: () => (
        <div
            className="flex h-full min-h-[calc(var(--full-height,100vh)-56px)] w-full items-center justify-center bg-background"
            aria-label="홈 지도 로딩 중"
        >
            <div className="h-16 w-16 rounded-full border-4 border-muted border-t-primary animate-spin" aria-hidden="true" />
        </div>
    ),
});

export default function HomeClientLoader() {
    return <HomeClient />;
}
