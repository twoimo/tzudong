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
        minimumCacheTTL: 60, // 캐시 TTL (초) - 성능 개선
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
    experimental: {
        forceSwcTransforms: false,
        optimizePackageImports: ['lucide-react', 'date-fns', 'recharts', 'lodash'],
    },
    // Turbopack 설정 추가 (Next.js 16 호환성)
    turbopack: {},
};

export default withBundleAnalyzer(nextConfig);
