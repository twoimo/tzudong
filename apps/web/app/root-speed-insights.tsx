export function shouldEnableRootSpeedInsights(
    environment: { VERCEL?: string; NEXT_PUBLIC_ENABLE_SPEED_INSIGHTS?: string } = process.env as { VERCEL?: string; NEXT_PUBLIC_ENABLE_SPEED_INSIGHTS?: string },
) {
    return (
        environment.VERCEL === '1'
        || environment.NEXT_PUBLIC_ENABLE_SPEED_INSIGHTS === 'true'
    );
}

export async function RootSpeedInsights() {
    if (!shouldEnableRootSpeedInsights()) return null;

    const { AppSpeedInsights } = await import('./app-speed-insights');
    return <AppSpeedInsights enabled />;
}
