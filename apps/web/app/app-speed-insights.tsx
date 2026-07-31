'use client';

import dynamic from 'next/dynamic';
export function shouldRenderSpeedInsights(
    enabled: boolean,
    nodeEnv = process.env.NODE_ENV,
) {
    return enabled && nodeEnv === 'production';
}


const SpeedInsights = dynamic(
    () => import('@vercel/speed-insights/next').then((mod) => ({ default: mod.SpeedInsights })),
    { ssr: false }
);

export function AppSpeedInsights({ enabled }: { enabled: boolean }) {
    if (!shouldRenderSpeedInsights(enabled)) return null;

    return <SpeedInsights />;
}
