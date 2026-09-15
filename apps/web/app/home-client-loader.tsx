'use client';

import HomeClient from './home-client';

// Compatibility entry point: keep the same SSR frame as the direct home route.
// Browser-only SDKs remain deferred inside HomeClient's map data region.
export default function HomeClientLoader() {
    return <HomeClient />;
}
