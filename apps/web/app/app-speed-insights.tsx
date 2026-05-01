'use client';

import dynamic from 'next/dynamic';

const SpeedInsights = dynamic(
    () => import('@vercel/speed-insights/next').then((mod) => ({ default: mod.SpeedInsights })),
    { ssr: false }
);

export function AppSpeedInsights() {
    if (process.env.NODE_ENV !== 'production') return null;

    return <SpeedInsights />;
}
