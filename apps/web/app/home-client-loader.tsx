'use client';

import dynamic from 'next/dynamic';
const HomeClient = dynamic(() => import('./home-client'), {
    ssr: false,
    loading: () => (
        <div role="status" aria-live="polite" aria-label="쯔동여지도 홈 준비 중" className="sr-only" />
    ),
});

export default function HomeClientLoader() {
    return <HomeClient />;
}
