import path from 'path';
import { fileURLToPath } from 'url';
import bundleAnalyzer from '@next/bundle-analyzer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const withBundleAnalyzer = bundleAnalyzer({
    enabled: process.env.ANALYZE === 'true',
});

const isNextBuildCommand = process.argv.some((arg) => arg === 'build');
const shouldUseStandaloneOutput = process.env.NODE_ENV === 'production' && isNextBuildCommand && process.env.VERCEL !== '1';

const securityHeaders = [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
];

const NIGHTLY_OFFLINE_SUPABASE_ORIGIN = 'http://127.0.0.1:54321';
const SUPABASE_STORAGE_PATHNAME = '/storage/v1/object/public/**';

/**
 * @param {string | undefined} supabaseUrl
 * @param {{ nightlyOffline?: boolean, isProduction?: boolean, isVercel?: boolean }} options
 */
export function getSupabaseStorageRemotePattern(supabaseUrl, {
    nightlyOffline = false,
    isProduction = false,
    isVercel = false,
} = {}) {
    if (
        nightlyOffline
        && !isProduction
        && !isVercel
        && supabaseUrl === NIGHTLY_OFFLINE_SUPABASE_ORIGIN
    ) {
        return {
            protocol: 'http',
            hostname: '127.0.0.1',
            port: '54321',
            pathname: SUPABASE_STORAGE_PATHNAME,
        };
    }

    try {
        if (!supabaseUrl) return null;
        const parsedSupabaseUrl = new URL(supabaseUrl);
        if (parsedSupabaseUrl.protocol !== 'https:') return null;
        return {
            protocol: 'https',
            hostname: parsedSupabaseUrl.hostname,
            pathname: SUPABASE_STORAGE_PATHNAME,
        };
    } catch {
        return null;
    }
}

const supabaseStorageRemotePattern = getSupabaseStorageRemotePattern(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    {
        nightlyOffline: process.env.NIGHTLY_OFFLINE === '1',
        isProduction: process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production',
        isVercel: Boolean(process.env.VERCEL || process.env.VERCEL_ENV),
    },
);

/** @type {import('next').NextConfig} */
const nextConfig = {
    images: {
        // [OPTIMIZATION] 이미지 최적화 설정 (예상 LCP 개선: ~300ms)
        formats: ['image/avif', 'image/webp'], // AVIF 우선, WebP fallback
        deviceSizes: [640, 750, 828, 1080, 1200, 1920], // 반응형 이미지 크기
        imageSizes: [16, 32, 48, 64, 96, 128, 256, 384], // 아이콘/썸네일 크기
        minimumCacheTTL: 2678400, // [PERF] 31일 캐시 (이미지가 자주 변경되지 않음)
        dangerouslyAllowSVG: true, // SVG 허용
        // 로컬 개발 환경(WSL/NAT64)에서 Supabase CDN이 private IP로 해석되는 경우가 있어 dev에서만 허용
        dangerouslyAllowLocalIP: process.env.NODE_ENV !== 'production',
        contentDispositionType: 'attachment', // SVG 보안
        contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
        remotePatterns: [
            {
                protocol: 'https',
                hostname: 'maps.googleapis.com',
            },
            {
                protocol: 'https',
                hostname: 'lh3.googleusercontent.com',
            },
            // [OPTIMIZATION] YouTube 썸네일 도메인 - Next/Image 최적화 지원
            {
                protocol: 'https',
                hostname: 'img.youtube.com',
            },
            {
                protocol: 'https',
                hostname: 'i.ytimg.com',
            },
            // [OPTIMIZATION] Supabase 스토리지 도메인 (현재 프로젝트 URL 기준)
            ...(supabaseStorageRemotePattern ? [supabaseStorageRemotePattern] : []),
        ],
    },
    env: {
        NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,
        NEXT_PUBLIC_NAVER_CLIENT_ID: process.env.NEXT_PUBLIC_NAVER_CLIENT_ID,
    },
    ...(shouldUseStandaloneOutput ? {
        output: 'standalone',
        outputFileTracingRoot: path.join(__dirname, '../../'),
    } : {}),
    outputFileTracingExcludes: {
        '/api/admin/storyboard': ['./backend/**/*', './.omx/**/*', './README.md', './apps/web/README.md'],
        '/api/admin/storyboard/chat': ['./backend/**/*', './.omx/**/*', './README.md', './apps/web/README.md'],
        '/api/admin/storyboard/images': ['./backend/**/*', './.omx/**/*', './README.md', './apps/web/README.md'],
        '/api/admin/youtube-thumbnail-generator': ['./backend/**/*', './.omx/**/*', './README.md', './apps/web/README.md'],
        '/api/admin/youtube-thumbnail-generator/chat': ['./backend/**/*', './.omx/**/*', './README.md', './apps/web/README.md'],
        '/api/admin/youtube-thumbnail-generator/history': ['./backend/**/*', './.omx/**/*', './README.md', './apps/web/README.md'],
        '/api/admin/youtube-thumbnail-generator/release-candidates': ['./backend/**/*', './.omx/**/*', './README.md', './apps/web/README.md'],
        '/api/admin/youtube-thumbnail-generator/release-candidates/promote': ['./backend/**/*', './.omx/**/*', './README.md', './apps/web/README.md'],
        '/api/admin/youtube-thumbnail-generator/releases/assets/\[releaseId\]': ['./backend/**/*', './.omx/**/*', './README.md', './apps/web/README.md'],
        '/api/admin/youtube-thumbnail-generator/releases/current': ['./backend/**/*', './.omx/**/*', './README.md', './apps/web/README.md'],
        '/api/admin/youtube-thumbnail-generator/releases/publish': ['./backend/**/*', './.omx/**/*', './README.md', './apps/web/README.md'],
    },
    typedRoutes: false,
    async redirects() {
        return [
            {
                source: '/submissions',
                destination: '/mypage',
                permanent: false,
            },
        ];
    },
    // [PERF] 정적 자산에 대한 장기 캐시 헤더 설정
    async headers() {
        return [
            {
                source: '/:path*',
                headers: securityHeaders,
            },
            {
                source: '/images/:path*',
                headers: [
                    ...securityHeaders,
                    { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
                ],
            },
            {
                source: '/fonts/:path*',
                headers: [
                    ...securityHeaders,
                    { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
                ],
            },
            {
                source: '/favicon.ico',
                headers: [
                    ...securityHeaders,
                    { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
                ],
            },
            {
                source: '/logo.png',
                headers: [
                    ...securityHeaders,
                    { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
                ],
            },
            {
                source: '/logo.webp',
                headers: [
                    ...securityHeaders,
                    { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
                ],
            },
            {
                source: '/:icon(favicon-32x32|apple-touch-icon).png',
                headers: [
                    ...securityHeaders,
                    { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
                ],
            },
            {
                source: '/scripts/:path*',
                headers: [
                    ...securityHeaders,
                    { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
                ],
            },
        ];
    },
    webpack: (config, { dev }) => {
        if (dev) {
            config.devtool = false;
            config.cache = false;
            const warnings = config.ignoreWarnings ?? [];
            config.ignoreWarnings = [
                ...warnings,
                {
                    message: /Invalid source map\. Only conformant source maps can be used to find the original code/,
                },
            ];
        }
        return config;
    },
    // Turbopack 설정 추가 (Next.js 16 호환성)
    turbopack: {},
    experimental: {
        turbopackFileSystemCacheForDev: false,
        optimizePackageImports: [
            'lucide-react',
            'date-fns',
            'recharts',
            'lodash',
            '@radix-ui/react-accordion',
            '@radix-ui/react-alert-dialog',
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-popover',
            '@radix-ui/react-select',
            '@radix-ui/react-tabs',
            '@radix-ui/react-tooltip',
            '@radix-ui/react-toast',
            'framer-motion',
            'react-hook-form',
            'zod',
            'sonner',
            'cmdk',
        ],
        staleTimes: {
            dynamic: 30,
            static: 180,
        },
    },
    // [PERF] 컴파일러 최적화
    compiler: {
        // 프로덕션에서 console.log 제거 (번들 크기 + 런타임 성능)
        removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error', 'warn'] } : false,
    },
};

export default withBundleAnalyzer(nextConfig);
