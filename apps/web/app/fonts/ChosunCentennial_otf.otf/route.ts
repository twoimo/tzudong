import { publicLargeAssetRedirects } from '@/lib/public-large-assets.mjs';

// Keep this legacy URL rollbackable. The measured Next config redirect omitted
// its configured Cache-Control header, so return the header at the route boundary.
export function GET() {
    return new Response(null, {
        status: 307,
        headers: {
            Location: publicLargeAssetRedirects[0].destination,
            'Cache-Control': 'no-store',
        },
    });
}

export { GET as HEAD };
