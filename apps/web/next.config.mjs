import path from 'path';
import { fileURLToPath } from 'url';
import bundleAnalyzer from '@next/bundle-analyzer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const withBundleAnalyzer = bundleAnalyzer({
    enabled: process.env.ANALYZE === 'true',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
    images: {
        // [OPTIMIZATION] 이미지 최적화 설정 (예상 LCP 개선: ~300ms)
        formats: ['image/avif', 'image/webp'], // AVIF 우선, WebP fallback
        deviceSizes: [640, 750, 828, 1080, 1200, 1920], // 반응형 이미지 크기
        imageSizes: [16, 32, 48, 64, 96, 128, 256, 384], // 아이콘/썸네일 크기
        minimumCacheTTL: 2678400, // [PERF] 31일 캐시 (이미지가 자주 변경되지 않음)
        dangerouslyAllowSVG: true, // SVG 허용
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
            // [OPTIMIZATION] Supabase 스토리지 도메인
            {
                protocol: 'https',
                hostname: '*.supabase.co',
            },
        ],
    },
    env: {
        NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,
        NEXT_PUBLIC_NAVER_CLIENT_ID: process.env.NEXT_PUBLIC_NAVER_CLIENT_ID,
        NEXT_PUBLIC_NAVER_CLIENT_SECRET: process.env.NEXT_PUBLIC_NAVER_CLIENT_SECRET,
    },
    output: 'standalone',
    outputFileTracingRoot: path.join(__dirname, '../../'),
    // [PERF] 정적 자산에 대한 장기 캐시 헤더 설정
    async headers() {
        return [
            {
                source: '/images/:path*',
                headers: [
                    { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
                ],
            },
            {
                source: '/fonts/:path*',
                headers: [
                    { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
                ],
            },
        ];
    },
    experimental: {
        // [PERF] 트리쉐이킹을 위한 패키지 임포트 최적화 - 번들 크기 대폭 감소
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
        // [PERF] 라우터 캐시로 페이지 이동 속도 향상
        staleTimes: {
            dynamic: 30,  // 동적 페이지 30초 캐시
            static: 180,  // 정적 페이지 3분 캐시
        },
    },
    // Turbopack 설정 추가 (Next.js 16 호환성)
    turbopack: {},
    // [PERF] 컴파일러 최적화
    compiler: {
        // 프로덕션에서 console.log 제거 (번들 크기 + 런타임 성능)
        removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error', 'warn'] } : false,
    },
};

export default withBundleAnalyzer(nextConfig);
