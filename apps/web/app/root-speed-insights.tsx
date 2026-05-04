const shouldEnableSpeedInsights =
    process.env.VERCEL === '1'
    || process.env.NEXT_PUBLIC_ENABLE_SPEED_INSIGHTS === 'true';

export async function RootSpeedInsights() {
    if (!shouldEnableSpeedInsights) return null;

    const { AppSpeedInsights } = await import('./app-speed-insights');
    return <AppSpeedInsights enabled />;
}
